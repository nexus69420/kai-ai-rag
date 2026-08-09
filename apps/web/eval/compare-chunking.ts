import "dotenv/config";

import { CHUNK_STRATEGIES, type ChunkStrategy } from "../src/lib/chunking";
import {
  buildRunConfig,
  loadGoldenSet,
  parseFlags,
  readBoolean,
  readNumber,
  readStrategy,
  resolveApiKeyOrExit,
} from "./lib/cli";
import { writeComparison, writeReport } from "./lib/report";
import { runEval } from "./lib/runner";
import type { RunReport } from "./lib/types";

const USAGE = `
Usage: npm run eval:chunking -- [options]

Runs the golden set once per chunking strategy against identical retrieval
settings, then writes a side-by-side comparison.

  --strategies <a,b,c>   Strategies to compare (default fixed,structural,semantic)
  --mode <hybrid|dense|sparse>  Retrieval mode held constant (default hybrid)
  --top-k <n>            Passages sent to the model (default 5)
  --limit <n>            Run only the first n cases (useful for a smoke run)
  --concurrency <n>      Parallel cases (default 2)
  --force-reindex        Rebuild each index even if it matches
`;

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return;
  }

  const apiKey = resolveApiKeyOrExit();
  const golden = loadGoldenSet();

  const strategies: ChunkStrategy[] =
    typeof flags.strategies === "string"
      ? flags.strategies.split(",").map((value) => readStrategy(value.trim()))
      : [...CHUNK_STRATEGIES];

  const limit = flags.limit ? Math.round(readNumber(flags.limit, 0)) : undefined;
  const force = readBoolean(flags.forceReindex, false);
  const reports: RunReport[] = [];

  for (const strategy of strategies) {
    console.log(`\n═══ ${strategy} ═══════════════════════════════`);
    const config = buildRunConfig(
      { ...flags, strategy },
      { label: strategy },
    );

    const report = await runEval(config, {
      apiKey,
      cases: golden.cases,
      limit,
      force,
      onProgress: (message) => console.log(message),
    });

    writeReport(report, `run-${strategy}-${config.mode}`);
    reports.push(report);
  }

  const { mdPath, jsonPath } = writeComparison(reports, "compare-chunking");

  console.log("\n─── Chunking comparison ───────────────────");
  for (const report of reports) {
    console.log(
      `${report.config.strategy.padEnd(11)} correctness ${pct(report.aggregate.correctness)} · recall ${pct(report.aggregate.retrievalRecall)} · MRR ${report.aggregate.retrievalMrr.toFixed(3)} · chunks ${report.index.chunks}`,
    );
  }
  console.log(`\nComparison written:\n  ${mdPath}\n  ${jsonPath}`);
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
