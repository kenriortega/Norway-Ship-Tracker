import {
  closeDatabase,
  createDatabase,
  type DatabaseConnection,
} from "@norway-ship-tracker/db";

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
 * Una conexión y no un pool: con una por petición, un pool solo añadiría
 * sockets que esta petición no va a usar. Cuando entre Hyperdrive, el pool de
 * verdad vivirá ahí y aquí seguirá bastando con abrir, consultar y cerrar.
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
