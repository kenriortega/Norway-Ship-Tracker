import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const migrationsDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations",
);
const client = postgres(databaseUrl, { max: 1, prepare: false });

function withoutOuterTransaction(contents: string): string {
  return contents
    .replace(/^\s*BEGIN\s*;\s*/i, "")
    .replace(/\s*COMMIT\s*;\s*$/i, "");
}

try {
  await client`
    CREATE TABLE IF NOT EXISTS app_schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await client`SELECT pg_advisory_lock(hashtext('norway_ship_tracker_migrations'))`;

  const migrationNames = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();

  for (const name of migrationNames) {
    const contents = await readFile(resolve(migrationsDirectory, name), "utf8");
    const checksum = createHash("sha256").update(contents).digest("hex");
    const [existing] = await client<[{ checksum: string }]>`
      SELECT checksum FROM app_schema_migrations WHERE name = ${name}
    `;

    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(`Migration ${name} changed after it was applied`);
      }
      console.info(`already applied: ${name}`);
      continue;
    }

    await client.begin(async (transaction) => {
      await transaction.unsafe(withoutOuterTransaction(contents));
      await transaction`
        INSERT INTO app_schema_migrations (name, checksum)
        VALUES (${name}, ${checksum})
      `;
    });
    console.info(`applied: ${name}`);
  }
} finally {
  await client`SELECT pg_advisory_unlock(hashtext('norway_ship_tracker_migrations'))`.catch(
    () => undefined,
  );
  await client.end({ timeout: 5 });
}
