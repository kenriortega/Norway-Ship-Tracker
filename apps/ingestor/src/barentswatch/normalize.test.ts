import assert from "node:assert/strict";
import test from "node:test";

import { normalizeBarentswatchMessage } from "./normalize.js";

test("normalizes a BarentsWatch position", () => {
  const receivedAt = new Date("2026-10-18T20:33:00Z");
  const update = normalizeBarentswatchMessage(
    {
      mmsi: 257011940,
      msgtime: "2026-10-18T20:32:37+00:00",
      latitude: 69.543985,
      longitude: 17.769428,
      name: " BALDER ",
      shipType: 33,
      speedOverGround: 0,
      courseOverGround: 356.7,
    },
    receivedAt,
  );

  assert.ok(update);
  assert.equal(update.provider, "barentswatch");
  assert.equal(update.name, "BALDER");
  assert.equal(update.receivedAt, receivedAt);
  assert.equal(update.observedAt.toISOString(), "2026-10-18T20:32:37.000Z");
});

test("rejects invalid coordinates and timestamps", () => {
  assert.equal(
    normalizeBarentswatchMessage({
      mmsi: 257011940,
      msgtime: "not-a-date",
      latitude: 95,
      longitude: 17,
    }),
    null,
  );
});
