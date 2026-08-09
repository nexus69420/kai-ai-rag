import { mkdirSync, writeFileSync } from "fs";
import path from "path";

import type { RunReport } from "./types";

export const REPORT_DIR = path.join(process.cwd(), "eval", "reports");

export function writeReport(report: RunReport, slug: string) {
  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = report.startedAt.replace(/[:.]/g, "-");
  const base = `${slug}-${stamp}`;

  const jsonPath = path.join(REPORT_DIR, `${base}.json`);
  const mdPath = path.join(REPORT_DIR, `${base}.md`);

  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, renderRunMarkdown(report));

  return { jsonPath, mdPath };
}

export function renderRunMarkdown(report: RunReport): string {
  const { config, aggregate, index } = report;

  const rows = report.results.map((result) =>
    [
      result.id,
      result.type,
      pct(result.correctness),
      result.retrievalHit === null ? "—" : result.retrievalHit ? "hit" : "miss",
      result.faithfulness === null ? "—" : pct(result.faithfulness),
      result.citationAccuracy === null ? "—" : pct(result.citationAccuracy),
      result.abstained ? "yes" : "no",
      result.abstainCorrect ? "ok" : "wrong",
      pct(result.confidence),
      `${result.durationMs}ms`,
    ].join(" | "),
  );

  const failures = report.results.filter(
    (result) => result.correctness < 1 || !result.abstainCorrect,
  );

  return `# Eval run — ${config.label}

- Started: ${report.startedAt}
- Finished: ${report.finishedAt}
- Chunking: **${config.strategy}** · Retrieval: **${config.mode}** (${config.denseWeight}/${config.sparseWeight}) · topK **${config.topK}**
- Rerank: ${config.rerank ? "on" : "off"} · Citation verification: ${config.verifyCitations ? "on" : "off"} · Abstain threshold: ${pct(config.abstainThreshold)}
- Models: ${config.chatModel} (answer), ${config.judgeModel} (judge), ${config.embeddingModel} (embeddings)
- Index: ${index.documents} documents, ${index.chunks} chunks${index.reused ? " (reused)" : ""}

## Headline metrics

| Metric | Score |
| --- | --- |
| Answer correctness | **${pct(aggregate.correctness)}** |
| Faithfulness (claims grounded in retrieved context) | **${pct(aggregate.faithfulness)}** |
| Citation accuracy (cited sources actually support the claim) | **${pct(aggregate.citationAccuracy)}** |
| Retrieval recall (expected document in top-k) | **${pct(aggregate.retrievalRecall)}** |
| Retrieval MRR | ${aggregate.retrievalMrr.toFixed(3)} |
| Exact-token recall (\`mustInclude\`) | ${pct(aggregate.mustIncludeRate)} |
| Abstain accuracy (answered when it should, declined when it should) | ${pct(aggregate.abstainAccuracy)} |
| Mean reported confidence | ${pct(aggregate.meanConfidence)} |
| Mean latency | ${aggregate.meanLatencyMs} ms |

## By question type

| Type | Cases | Correctness | Retrieval recall |
| --- | --- | --- | --- |
${Object.entries(aggregate.byType)
  .map(
    ([type, stats]) =>
      `| ${type} | ${stats.cases} | ${pct(stats.correctness)} | ${pct(stats.retrievalRecall)} |`,
  )
  .join("\n")}

## Per-case results

| Case | Type | Correct | Retrieval | Faithful | Citations | Abstained | Gate | Confidence | Latency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows.map((row) => `| ${row} |`).join("\n")}

## Cases needing attention

${
  failures.length
    ? failures
        .map(
          (result) =>
            `- **${result.id}** (${result.type}) — correctness ${pct(result.correctness)}${result.abstainCorrect ? "" : ", gate wrong"}. ${result.correctnessReason || result.error || ""}`,
        )
        .join("\n")
    : "None — every case scored full correctness and the abstain gate behaved correctly."
}
`;
}

export function writeComparison(reports: RunReport[], slug: string) {
  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mdPath = path.join(REPORT_DIR, `${slug}-${stamp}.md`);
  const jsonPath = path.join(REPORT_DIR, `${slug}-${stamp}.json`);

  writeFileSync(mdPath, renderComparisonMarkdown(reports));
  writeFileSync(
    jsonPath,
    JSON.stringify(
      reports.map((report) => ({
        label: report.config.label,
        config: report.config,
        aggregate: report.aggregate,
      })),
      null,
      2,
    ),
  );

  return { mdPath, jsonPath };
}

export function renderComparisonMarkdown(reports: RunReport[]): string {
  const metrics: Array<{
    key: keyof RunReport["aggregate"];
    label: string;
    format?: (value: number) => string;
  }> = [
    { key: "correctness", label: "Answer correctness" },
    { key: "faithfulness", label: "Faithfulness" },
    { key: "citationAccuracy", label: "Citation accuracy" },
    { key: "retrievalRecall", label: "Retrieval recall" },
    {
      key: "retrievalMrr",
      label: "Retrieval MRR",
      format: (value) => value.toFixed(3),
    },
    { key: "mustIncludeRate", label: "Exact-token recall" },
    { key: "abstainAccuracy", label: "Abstain accuracy" },
    {
      key: "meanLatencyMs",
      label: "Mean latency (ms)",
      format: (value) => String(Math.round(value)),
    },
  ];

  const header = `| Metric | ${reports.map((r) => r.config.label).join(" | ")} |`;
  const divider = `| --- | ${reports.map(() => "---").join(" | ")} |`;

  const body = metrics
    .map((metric) => {
      const values = reports.map(
        (report) => report.aggregate[metric.key] as number,
      );
      const best =
        metric.key === "meanLatencyMs"
          ? Math.min(...values)
          : Math.max(...values);

      const cells = values.map((value) => {
        const formatted = metric.format ? metric.format(value) : pct(value);
        return value === best ? `**${formatted}**` : formatted;
      });

      return `| ${metric.label} | ${cells.join(" | ")} |`;
    })
    .join("\n");

  const indexRows = reports
    .map(
      (report) =>
        `| ${report.config.label} | ${report.config.strategy} | ${report.config.mode} | ${report.index.chunks} | ${report.aggregate.cases} |`,
    )
    .join("\n");

  return `# Comparison report

Generated ${new Date().toISOString()}

## Configurations

| Label | Chunking | Retrieval | Chunks indexed | Cases |
| --- | --- | --- | --- | --- |
${indexRows}

## Metrics

${header}
${divider}
${body}

## Reading this table

- **Retrieval recall** and **MRR** isolate the retriever: they ignore the answer
  text entirely and ask whether the expected document reached the model.
- **Faithfulness** counts claims supported by *some* retrieved passage.
  **Citation accuracy** is stricter: the specific source the answer cited must
  support the claim.
- **Abstain accuracy** rewards declining unanswerable questions and answering
  answerable ones, so a configuration cannot win by refusing everything.
`;
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}
