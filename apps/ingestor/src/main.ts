import {
  closeDatabase,
  createDatabase,
  persistVesselUpdate,
} from "@norway-ship-tracker/db";

import { TokenManager } from "./barentswatch/auth.js";
import {
  ingestLatestSnapshot,
  runLiveStream,
  type StreamCallbacks,
} from "./barentswatch/client.js";
import { loadConfig } from "./config.js";
import { initialHealth, startHealthServer } from "./health.js";

const config = loadConfig();
const database = createDatabase(config.databaseUrl, 5);
const tokenManager = new TokenManager(
  config.tokenUrl,
  config.clientId,
  config.clientSecret,
  config.scope,
);
const health = initialHealth();
const healthServer = startHealthServer(config.healthPort, health);
const shutdown = new AbortController();

function describeError(value: unknown): string {
  const messages: string[] = [];
  let current: unknown = value;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  if (messages.length === 0) messages.push(String(value));
  return messages.join(" <- ");
}

const streamOptions = {
  streamUrl: config.streamUrl,
  latestUrl: config.latestUrl,
  initialBackoffMs: config.initialBackoffMs,
  maxBackoffMs: config.maxBackoffMs,
};

const callbacks: StreamCallbacks = {
  onConnected() {
    health.authenticated = true;
    health.streamConnected = true;
    health.lastError = null;
    console.info(JSON.stringify({ event: "ais_stream_connected" }));
  },
  onDisconnected() {
    health.streamConnected = false;
  },
  onInvalidMessage() {
    health.invalidMessages += 1;
  },
  onReconnect() {
    health.reconnects += 1;
  },
  onError(error) {
    health.lastError = describeError(error);
    console.error(JSON.stringify({ event: "ais_stream_error", error: health.lastError }));
  },
  async onUpdate(update) {
    try {
      await persistVesselUpdate(database, update, config.historySampleSeconds);
      health.processedMessages += 1;
      health.lastMessageAt = new Date().toISOString();
      health.lastSourceTimestamp = update.observedAt.toISOString();
    } catch (error) {
      health.persistenceFailures += 1;
      throw error;
    }
  },
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => shutdown.abort());
}

try {
  await tokenManager.getToken(shutdown.signal);
  health.authenticated = true;

  if (config.bootstrapSnapshot) {
    try {
      const count = await ingestLatestSnapshot(
        tokenManager,
        streamOptions,
        callbacks,
        shutdown.signal,
      );
      console.info(JSON.stringify({ event: "ais_snapshot_ingested", count }));
    } catch (error) {
      callbacks.onError(error);
      console.warn(JSON.stringify({ event: "ais_snapshot_skipped" }));
    }
  }

  await runLiveStream(tokenManager, streamOptions, callbacks, shutdown.signal);
} catch (error) {
  if (!shutdown.signal.aborted) {
    callbacks.onError(error);
    process.exitCode = 1;
  }
} finally {
  health.streamConnected = false;
  healthServer.close();
  await closeDatabase(database);
}
