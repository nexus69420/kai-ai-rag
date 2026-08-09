import "dotenv/config";

import { envApiKeys } from "../src/lib/api-keys";
import { isChunkStrategy } from "../src/lib/chunking";
import { ensureCorpusIndexed } from "../eval/lib/workspace";

export const DEMO_WORKSPACE_ID =
  process.env.KAI_DEMO_WORKSPACE_ID ?? "kai-demo-workspace";

/**
 * Indexes the evaluation corpus into a fixed demo workspace so a fresh clone
 * has something to query. Visit /api/demo (with KAI_ENABLE_DEMO=1) to attach
 * the browser session to this workspace.
 */
async function main() {
  const apiKey = envApiKeys()[0];
  if (!apiKey) {
    console.error("GOOGLE_API_KEY is required to embed the seed corpus.");
    process.exit(1);
  }

  const strategyArg = process.argv
    .find((arg) => arg.startsWith("--strategy="))
    ?.split("=")[1];
  const strategy = isChunkStrategy(strategyArg) ? strategyArg : "structural";
  const force = process.argv.includes("--force");

  const summary = await ensureCorpusIndexed({
    strategy,
    apiKey,
    embeddingModel: process.env.KAI_EMBEDDING_MODEL ?? "gemini-embedding-001",
    workspaceId: DEMO_WORKSPACE_ID,
    dedupe: true,
    force,
    onProgress: (message) => console.log(message),
  });

  console.log("\nSeed complete.");
  console.log(`  Workspace : ${summary.workspaceId}`);
  console.log(`  Documents : ${summary.documents}`);
  console.log(`  Chunks    : ${summary.chunks}`);
  console.log(`  Strategy  : ${summary.strategy}`);
  console.log(
    "\nSet KAI_ENABLE_DEMO=1 and open http://localhost:3000/api/demo to use it.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
