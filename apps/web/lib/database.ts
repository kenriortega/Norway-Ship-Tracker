import {
  closeDatabase,
  createDatabase,
  type DatabaseConnection,
} from "@norway-ship-tracker/db";

/**
 * Ejecuta `work` con una conexión propia y la cierra al terminar.
 *
 * La web corre junto a la base, en la misma red de compose, así que la
 * conexión es local y barata. Hubo una etapa en Cloudflare Workers donde esto
 * salía de un binding de Hyperdrive; ver el ADR 0005 para por qué se retiró.
 *
 * Una conexión por petición y no un pool compartido: el coste de abrirla
 * contra un Postgres que está a un salto de red interna es despreciable, y
 * evita tener que razonar sobre el estado del pool entre peticiones.
 */
export async function withDatabase<T>(
  work: (connection: DatabaseConnection) => Promise<T>,
): Promise<T> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const connection = createDatabase(databaseUrl, 1);
  try {
    return await work(connection);
  } finally {
    await closeDatabase(connection);
  }
}
