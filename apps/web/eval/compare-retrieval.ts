import "dotenv/config";

import { RETRIEVAL_MODES, type RetrievalMode } from "../src/lib/retrieve";
import {
  buildRunConfig,
  loadGoldenSet,
  parseFlags,
  readBoolean,
  readMode,
  readNumber,
  resolveApiKeyOrExit,
} from "./lib/cli";
import { writeComparison, writeReport } from "./lib/report";
import { runEval } from "./lib/runner";
import type { RunReport } from "./lib/types";

const USAGE = `
Usage: npm run eval:retrieval -- [options]

Runs the golden set once per retrieval mode against one shared index, so the
only variable is the retriever.

  --modes <a,b,c>    Modes to compare (default hybrid,dense,sparse)
  --strategy <name>  Chunking strategy held constant (default structural)
  --top-k <n>        Passages sent to the model (default 5)
  --limit <n>        Run only the first n cases
  --concurrency <n>  Parallel cases (default 2)
`;

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return;
  }

  const apiKey = resolveApiKeyOrExit();
  const golden = loadGoldenSet();

  const modes: RetrievalMode[] =
    typeof flags.modes === "string"
      ? flags.modes.split(",").map((value) => readMode(value.trim()))
      : [...RETRIEVAL_MODES];

  const limit = flags.limit ? Math.round(readNumber(flags.limit, 0)) : undefined;
  const reports: RunReport[] = [];

  for (const [position, mode] of modes.entries()) {
    console.log(`\n═══ ${mode} ═══════════════════════════════`);
    const config = buildRunConfig({ ...flags, mode }, { label: mode });

    const report = await runEval(config, {
      apiKey,
      cases: golden.cases,
      limit,
      // Only the first pass may rebuild; the rest share that index.
      force: position === 0 && readBoolean(flags.forceReindex, false),
      onProgress: (message) => console.log(message),
    });

    writeReport(report, `run-${config.strategy}-${mode}`);
    reports.push(report);
  }

  const { mdPath, jsonPath } = writeComparison(reports, "compare-retrieval");

  console.log("\n─── Retrieval comparison ──────────────────");
  for (const report of reports) {
    console.log(
      `${report.config.mode.padEnd(8)} correctness ${pct(report.aggregate.correctness)} · recall ${pct(report.aggregate.retrievalRecall)} · MRR ${report.aggregate.retrievalMrr.toFixed(3)} · exact tokens ${pct(report.aggregate.mustIncludeRate)}`,
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
