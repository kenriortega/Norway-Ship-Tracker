import { createDatabase, type DatabaseConnection } from "@norway-ship-tracker/db";

let connection: DatabaseConnection | undefined;

export function getDatabase(): DatabaseConnection {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  connection ??= createDatabase(databaseUrl, 3);
  return connection;
}
