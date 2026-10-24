import {
  closeDatabase,
  createDatabase,
  type DatabaseConnection,
} from "@norway-ship-tracker/db";

/**
 * Cadena de conexión a usar.
 *
 * En Workers la da Hyperdrive, que mantiene el pool del lado de Cloudflare y
 * entrega una cadena distinta por petición. En desarrollo contra una base
 * local ese binding no existe y se cae a `DATABASE_URL`.
 *
 * El `import` es dinámico porque `cloudflare:workers` solo existe dentro de
 * workerd: resolverlo de forma estática rompería cualquier build que no sea
 * para Workers.
 */
async function connectionString(): Promise<string> {
  try {
    const { env } = await import("cloudflare:workers");
    const hyperdrive = (env as Record<string, unknown>).HYPERDRIVE as
      | { connectionString?: string }
      | undefined;
    if (hyperdrive?.connectionString) return hyperdrive.connectionString;
  } catch {
    // Fuera de workerd no hay binding; se sigue por el entorno.
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  return databaseUrl;
}

/**
 * Ejecuta `work` con una conexión propia y la cierra al terminar.
 *
 * No hay conexión compartida entre peticiones, y no es una ineficiencia que se
 * nos haya colado: en Workers un socket abierto durante una petición no se
 * puede reutilizar en la siguiente. El singleton que había antes funcionaba en
 * Node y aquí dejaba la segunda petición colgada hasta que el runtime la
 * cancelaba por "código colgado", sin error que mirar.
 *
 * El `finally` tampoco es opcional. Sin él se cambia el cuelgue por una fuga:
 * un socket por petición que nadie recoge.
 *
 * Una conexión y no un pool: el pool de verdad vive en Hyperdrive, así que
 * abrir varias aquí solo añadiría sockets que esta petición no va a usar.
 */
export async function withDatabase<T>(
  work: (connection: DatabaseConnection) => Promise<T>,
): Promise<T> {
  const connection = createDatabase(await connectionString(), 1);
  try {
    return await work(connection);
  } finally {
    await closeDatabase(connection);
  }
}
