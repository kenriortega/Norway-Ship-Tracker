import type { VesselUpdate } from "@norway-ship-tracker/domain";

import { TokenManager } from "./auth.js";
import { parseNdjsonStream } from "./ndjson.js";
import { normalizeBarentswatchMessage } from "./normalize.js";

export interface StreamCallbacks {
  onConnected(): void;
  onDisconnected(): void;
  onInvalidMessage(): void;
  onReconnect(): void;
  onError(error: unknown): void;
  onUpdate(update: VesselUpdate): Promise<void>;
}

interface StreamOptions {
  streamUrl: string;
  latestUrl: string;
  initialBackoffMs: number;
  maxBackoffMs: number;
}

async function authorizedFetch(
  url: string,
  tokenManager: TokenManager,
  signal: AbortSignal,
): Promise<Response> {
  const token = await tokenManager.getToken(signal);
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal,
  });

  if (response.status === 401) tokenManager.invalidate();
  return response;
}

export async function ingestLatestSnapshot(
  tokenManager: TokenManager,
  options: StreamOptions,
  callbacks: StreamCallbacks,
  signal: AbortSignal,
): Promise<number> {
  const response = await authorizedFetch(options.latestUrl, tokenManager, signal);
  if (!response.ok) {
    throw new Error(`BarentsWatch snapshot failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error("BarentsWatch snapshot did not return an array");
  }

  let accepted = 0;
  const receivedAt = new Date();
  for (const item of payload) {
    const update = normalizeBarentswatchMessage(item, receivedAt);
    if (!update) {
      callbacks.onInvalidMessage();
      continue;
    }
    await callbacks.onUpdate(update);
    accepted += 1;
  }
  return accepted;
}

export async function runLiveStream(
  tokenManager: TokenManager,
  options: StreamOptions,
  callbacks: StreamCallbacks,
  signal: AbortSignal,
): Promise<never> {
  let backoffMs = options.initialBackoffMs;
  let attempts = 0;

  while (!signal.aborted) {
    if (attempts > 0) callbacks.onReconnect();
    attempts += 1;

    try {
      const response = await authorizedFetch(options.streamUrl, tokenManager, signal);
      if (!response.ok) {
        throw new Error(`BarentsWatch stream failed with HTTP ${response.status}`);
      }
      if (!response.body) {
        throw new Error("BarentsWatch stream returned no body");
      }

      callbacks.onConnected();
      backoffMs = options.initialBackoffMs;

      for await (const payload of parseNdjsonStream(response.body)) {
        const update = normalizeBarentswatchMessage(payload);
        if (!update) {
          callbacks.onInvalidMessage();
          continue;
        }
        await callbacks.onUpdate(update);
      }

      if (!signal.aborted) {
        throw new Error("BarentsWatch stream ended unexpectedly");
      }
    } catch (error) {
      callbacks.onDisconnected();
      if (signal.aborted) break;
      callbacks.onError(error);
    }

    await abortableDelay(backoffMs, signal);
    backoffMs = Math.min(backoffMs * 2, options.maxBackoffMs);
  }

  throw new Error("BarentsWatch stream stopped");
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}
