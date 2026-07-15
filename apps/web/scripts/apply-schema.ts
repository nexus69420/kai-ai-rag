import "dotenv/config";
import { readFileSync } from "fs";
import path from "path";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const sql = postgres(url, { max: 1 });
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
  const file = path.join(process.cwd(), "drizzle", "0000_init.sql");
  const ddl = readFileSync(file, "utf8");
  await sql.unsafe(ddl);
  await sql.end();
  console.log("Database schema applied.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
