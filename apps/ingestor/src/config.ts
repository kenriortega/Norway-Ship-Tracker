export interface IngestorConfig {
  databaseUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  tokenUrl: string;
  streamUrl: string;
  latestUrl: string;
  bootstrapSnapshot: boolean;
  historySampleSeconds: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  healthPort: number;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function loadConfig(): IngestorConfig {
  return {
    databaseUrl: required("DATABASE_URL"),
    clientId: required("BARENTSWATCH_CLIENT_ID"),
    clientSecret: required("BARENTSWATCH_CLIENT_SECRET"),
    scope: process.env.BARENTSWATCH_SCOPE?.trim() || "ais",
    tokenUrl:
      process.env.BARENTSWATCH_TOKEN_URL?.trim() ||
      "https://id.barentswatch.no/connect/token",
    streamUrl:
      process.env.BARENTSWATCH_STREAM_URL?.trim() ||
      "https://live.ais.barentswatch.no/v1/combined",
    latestUrl:
      process.env.BARENTSWATCH_LATEST_URL?.trim() ||
      "https://live.ais.barentswatch.no/v1/latest/combined",
    bootstrapSnapshot: process.env.AIS_BOOTSTRAP_SNAPSHOT !== "false",
    historySampleSeconds: positiveInteger("AIS_HISTORY_SAMPLE_SECONDS", 60),
    initialBackoffMs: positiveInteger("AIS_INITIAL_BACKOFF_MS", 1_000),
    maxBackoffMs: positiveInteger("AIS_MAX_BACKOFF_MS", 30_000),
    healthPort: positiveInteger("HEALTH_PORT", 3_001),
  };
}
