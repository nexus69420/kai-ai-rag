import "dotenv/config";
import { readdirSync, readFileSync } from "fs";
import path from "path";
import postgres from "postgres";

/** Applies every drizzle SQL file in filename order. All statements are idempotent. */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || url === "pglite" || url.startsWith("pglite:")) {
    throw new Error(
      "DATABASE_URL must point at a real Postgres instance (PGlite bootstraps itself).",
    );
  }

  const sql = postgres(url, { max: 1 });
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

  const dir = path.join(process.cwd(), "drizzle");
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const ddl = readFileSync(path.join(dir, file), "utf8");
    await sql.unsafe(ddl);
    console.log(`Applied ${file}`);
  }

  await sql.end();
  console.log(`Database schema applied (${files.length} migration files).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
