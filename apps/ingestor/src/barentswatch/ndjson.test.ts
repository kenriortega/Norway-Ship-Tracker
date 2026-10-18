import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseNdjsonStream } from "./ndjson.js";

test("parses NDJSON when network chunks split JSON objects", async () => {
  const fixture = await readFile(
    new URL("../../../../fixtures/barentswatch/positions.ndjson", import.meta.url),
    "utf8",
  );
  const bytes = new TextEncoder().encode(fixture);
  const splitPoints = [17, 83, 211, bytes.length];
  let start = 0;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const end of splitPoints) {
        controller.enqueue(bytes.slice(start, end));
        start = end;
      }
      controller.close();
    },
  });

  const messages: unknown[] = [];
  for await (const message of parseNdjsonStream(stream)) messages.push(message);

  assert.equal(messages.length, 2);
  assert.equal((messages[0] as { mmsi: number }).mmsi, 257011940);
  assert.equal((messages[1] as { name: string }).name, "SARPEN");
});
