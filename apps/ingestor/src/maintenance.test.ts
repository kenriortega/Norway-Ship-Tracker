import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { startHistoryMaintenance } from "./maintenance.js";

const EMPTY = { created: [], dropped: [] };

function recorder() {
  const results: Array<{ created: string[]; dropped: string[] }> = [];
  const errors: unknown[] = [];
  return {
    results,
    errors,
    callbacks: {
      onResult: (result: { created: string[]; dropped: string[] }) => void results.push(result),
      onError: (error: unknown) => void errors.push(error),
    },
  };
}

test("ejecuta una pasada nada más arrancar, sin esperar al intervalo", async () => {
  const { results, callbacks } = recorder();
  const schedule = startHistoryMaintenance({
    intervalMs: 60_000,
    run: async () => ({ created: ["vessel_positions_20260101"], dropped: [] }),
    callbacks,
  });

  await schedule.stop();

  assert.equal(results.length, 1);
  assert.deepEqual(results[0].created, ["vessel_positions_20260101"]);
});

test("repite en cada intervalo", async () => {
  const { results, callbacks } = recorder();
  const schedule = startHistoryMaintenance({
    intervalMs: 5,
    run: async () => EMPTY,
    callbacks,
  });

  await delay(40);
  await schedule.stop();

  assert.ok(results.length >= 3, `esperaba varias pasadas, hubo ${results.length}`);
});

test("un fallo se reporta y el ciclo continúa", async () => {
  const { results, errors, callbacks } = recorder();
  let attempt = 0;
  const schedule = startHistoryMaintenance({
    intervalMs: 5,
    run: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("no such function");
      return EMPTY;
    },
    callbacks,
  });

  await delay(40);
  await schedule.stop();

  assert.equal(errors.length, 1);
  assert.ok(results.length >= 1, "el ciclo debería haber seguido tras el fallo");
});

test("stop espera a que termine la pasada en curso y no lanza más", async () => {
  const { results, callbacks } = recorder();
  let finished = false;
  const schedule = startHistoryMaintenance({
    intervalMs: 5,
    run: async () => {
      await delay(20);
      finished = true;
      return EMPTY;
    },
    callbacks,
  });

  await schedule.stop();
  assert.equal(finished, true, "stop no esperó a la pasada en curso");

  const after = results.length;
  await delay(30);
  assert.equal(results.length, after, "el ciclo siguió corriendo tras stop");
});
