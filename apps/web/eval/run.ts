import "dotenv/config";

import {
  buildRunConfig,
  loadGoldenSet,
  parseFlags,
  readBoolean,
  readNumber,
  resolveApiKeyOrExit,
} from "./lib/cli";
import { writeReport } from "./lib/report";
import { runEval } from "./lib/runner";

const USAGE = `
Usage: npm run eval -- [options]

  --strategy <fixed|structural|semantic>  Chunking strategy (default structural)
  --mode <hybrid|dense|sparse>            Retrieval mode (default hybrid)
  --top-k <n>                             Passages sent to the model (default 5)
  --dense-weight <0..1>                   Dense share of RRF (default 0.7)
  --rerank <on|off>                       LLM reranking (default on)
  --verify <on|off>                       Citation verification (default on)
  --abstain-threshold <0..1>              Confidence gate (default 0.35)
  --type <lookup|multihop|no-answer|ambiguous>  Filter to one question type
  --limit <n>                             Run only the first n cases
  --concurrency <n>                       Parallel cases (default 2)
  --force-reindex                         Rebuild the index even if it matches
  --label <text>                          Label used in the report
`;

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return;
  }

  const apiKey = resolveApiKeyOrExit();
  const config = buildRunConfig(flags);
  const golden = loadGoldenSet();

  const typeFilter = typeof flags.type === "string" ? flags.type : null;
  const cases = typeFilter
    ? golden.cases.filter((item) => item.type === typeFilter)
    : golden.cases;

  if (!cases.length) {
    console.error(`No cases matched --type "${typeFilter}".`);
    process.exit(1);
  }

  const report = await runEval(config, {
    apiKey,
    cases,
    limit: flags.limit ? Math.round(readNumber(flags.limit, 0)) : undefined,
    force: readBoolean(flags.forceReindex, false),
    onProgress: (message) => console.log(message),
  });

  const slug = `run-${config.strategy}-${config.mode}`;
  const { jsonPath, mdPath } = writeReport(report, slug);

  const { aggregate } = report;
  console.log("\n─── Results ───────────────────────────────");
  console.log(`Cases              ${aggregate.cases}`);
  console.log(`Correctness        ${pct(aggregate.correctness)}`);
  console.log(`Faithfulness       ${pct(aggregate.faithfulness)}`);
  console.log(`Citation accuracy  ${pct(aggregate.citationAccuracy)}`);
  console.log(`Retrieval recall   ${pct(aggregate.retrievalRecall)}`);
  console.log(`Retrieval MRR      ${aggregate.retrievalMrr.toFixed(3)}`);
  console.log(`Exact-token recall ${pct(aggregate.mustIncludeRate)}`);
  console.log(`Abstain accuracy   ${pct(aggregate.abstainAccuracy)}`);
  console.log(`Mean latency       ${aggregate.meanLatencyMs} ms`);
  console.log(`\nReports written:\n  ${mdPath}\n  ${jsonPath}`);
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
