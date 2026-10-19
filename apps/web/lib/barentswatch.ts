import { TokenManager } from "@norway-ship-tracker/barentswatch";

const DEFAULT_TOKEN_URL = "https://id.barentswatch.no/connect/token";
const DEFAULT_HISTORIC_URL = "https://historic.ais.barentswatch.no/v1/historic/trackslast24hours";

// El token vive aquí, en el proceso del servidor, y no en cada petición: el
// `TokenManager` lo renueva con un minuto de margen, así que un clic normal no
// vuelve a salir a BarentsWatch. Mismo patrón que el pool de `database.ts`.
let tokenManager: TokenManager | undefined;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function getTokenManager(): TokenManager {
  tokenManager ??= new TokenManager(
    process.env.BARENTSWATCH_TOKEN_URL?.trim() || DEFAULT_TOKEN_URL,
    required("BARENTSWATCH_CLIENT_ID"),
    required("BARENTSWATCH_CLIENT_SECRET"),
    process.env.BARENTSWATCH_SCOPE?.trim() || "ais",
  );
  return tokenManager;
}

export function historicTrackUrl(mmsi: number): string {
  const base = process.env.BARENTSWATCH_HISTORIC_URL?.trim() || DEFAULT_HISTORIC_URL;
  return `${base.replace(/\/$/, "")}/${mmsi}`;
}
