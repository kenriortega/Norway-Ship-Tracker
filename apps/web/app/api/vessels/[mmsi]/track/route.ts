import type { VesselTrackPoint, VesselTrackResponse } from "@norway-ship-tracker/domain";
import { NextResponse, type NextRequest } from "next/server";

import { getTokenManager, historicTrackUrl } from "@/lib/barentswatch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// El recorrido de 24 h no cambia de forma apreciable en dos minutos, así que
// volver a clicar el mismo barco no tiene por qué salir a la red otra vez.
const CACHE_CONTROL = "private, max-age=120";

function parseMmsi(raw: string): number | null {
  const mmsi = Number(raw);
  if (!Number.isInteger(mmsi) || mmsi < 100_000_000 || mmsi > 999_999_999) return null;
  return mmsi;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * El histórico devuelve los mismos campos que el stream en vivo, así que
 * aplicamos las mismas validaciones y nos quedamos solo con lo que el mapa
 * necesita para dibujar la línea.
 */
function normalizeTrackPoint(value: unknown): VesselTrackPoint | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  const payload = value as Record<string, unknown>;
  const longitude = finiteNumber(payload.longitude);
  const latitude = finiteNumber(payload.latitude);
  const msgtime = typeof payload.msgtime === "string" ? payload.msgtime.trim() : "";

  if (
    longitude === null ||
    longitude < -180 ||
    longitude > 180 ||
    latitude === null ||
    latitude < -90 ||
    latitude > 90 ||
    !msgtime
  ) {
    return null;
  }

  const observedAt = new Date(msgtime);
  if (Number.isNaN(observedAt.getTime())) return null;

  return {
    longitude,
    latitude,
    observedAt: observedAt.toISOString(),
    speedOverGround: finiteNumber(payload.speedOverGround),
  };
}

async function fetchTrack(mmsi: number, signal: AbortSignal): Promise<Response> {
  const tokenManager = getTokenManager();
  const url = historicTrackUrl(mmsi);

  // Un 401 solo puede venir de un token caducado antes de tiempo, así que lo
  // invalidamos y damos una segunda (y única) oportunidad.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await tokenManager.getToken(signal);
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal,
      cache: "no-store",
    });

    if (response.status !== 401) return response;
    tokenManager.invalidate();
  }

  throw new Error("BarentsWatch rejected the cached token twice");
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ mmsi: string }> },
): Promise<NextResponse> {
  const { mmsi: rawMmsi } = await context.params;
  const mmsi = parseMmsi(rawMmsi);
  if (mmsi === null) {
    return NextResponse.json({ error: "mmsi must be a 9-digit number" }, { status: 400 });
  }

  try {
    const response = await fetchTrack(mmsi, request.signal);

    // Sin histórico no es un error: el mapa lo cuenta como "sin datos".
    if (response.status === 404) {
      const empty: VesselTrackResponse = {
        mmsi,
        points: [],
        generatedAt: new Date().toISOString(),
      };
      return NextResponse.json(empty, { headers: { "cache-control": CACHE_CONTROL } });
    }

    if (!response.ok) {
      throw new Error(`BarentsWatch historic track failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      throw new Error("BarentsWatch historic track did not return an array");
    }

    const points = payload
      .map(normalizeTrackPoint)
      .filter((point): point is VesselTrackPoint => point !== null)
      .sort((left, right) => left.observedAt.localeCompare(right.observedAt));

    const track: VesselTrackResponse = {
      mmsi,
      points,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(track, { headers: { "cache-control": CACHE_CONTROL } });
  } catch (error) {
    if (request.signal.aborted) {
      return NextResponse.json({ error: "Request aborted" }, { status: 499 });
    }

    // El detalle se queda en el servidor: puede nombrar credenciales o URLs
    // internas del proveedor.
    console.error("Unable to load vessel track", {
      mmsi,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Unable to load vessel track" }, { status: 502 });
  }
}
