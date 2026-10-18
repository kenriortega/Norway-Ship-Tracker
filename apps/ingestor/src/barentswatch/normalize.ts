import { AIS_PROVIDER, type VesselUpdate } from "@norway-ship-tracker/domain";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integer(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeBarentswatchMessage(
  value: unknown,
  receivedAt = new Date(),
): VesselUpdate | null {
  const payload = record(value);
  if (!payload) return null;

  const mmsi = integer(payload.mmsi);
  const latitude = finiteNumber(payload.latitude);
  const longitude = finiteNumber(payload.longitude);
  const msgtime = optionalString(payload.msgtime);

  if (
    mmsi === null ||
    mmsi < 100_000_000 ||
    mmsi > 999_999_999 ||
    latitude === null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude === null ||
    longitude < -180 ||
    longitude > 180 ||
    !msgtime
  ) {
    return null;
  }

  const observedAt = new Date(msgtime);
  if (Number.isNaN(observedAt.getTime())) return null;

  return {
    provider: AIS_PROVIDER,
    mmsi,
    observedAt,
    receivedAt,
    latitude,
    longitude,
    name: optionalString(payload.name),
    imoNumber: integer(payload.imoNumber),
    callSign: optionalString(payload.callSign),
    shipType: integer(payload.shipType),
    speedOverGround: finiteNumber(payload.speedOverGround),
    courseOverGround: finiteNumber(payload.courseOverGround),
    trueHeading: integer(payload.trueHeading),
    rateOfTurn: finiteNumber(payload.rateOfTurn),
    navigationalStatus: integer(payload.navigationalStatus),
    destination: optionalString(payload.destination),
    draughtMeters: finiteNumber(payload.draught),
    rawPayload: payload,
  };
}
