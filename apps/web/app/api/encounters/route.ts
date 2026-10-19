import { getEncounters } from "@norway-ship-tracker/db";
import type { EncountersResponse } from "@norway-ship-tracker/domain";
import { NextResponse, type NextRequest } from "next/server";

import { getDatabase } from "@/lib/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_MAX_METERS = 400;
const DEFAULT_WINDOW_HOURS = 24;
// El histórico se purga a los tres días completos más el día en curso, así que
// garantiza 72 h a cualquier hora. Pedir más devolvería una respuesta
// incompleta sin avisar, que es peor que un parámetro acotado.
const MAX_WINDOW_HOURS = 72;
const DEFAULT_MIN_MINUTES = 30;

function boundedParameter(
  parameters: URLSearchParams,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = parameters.get(name);
  if (raw === null) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`);
  return Math.max(minimum, Math.min(Math.trunc(parsed), maximum));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const parameters = request.nextUrl.searchParams;
    const found = await getEncounters(getDatabase(), {
      maxMeters: boundedParameter(parameters, "meters", DEFAULT_MAX_METERS, 10, 5_000),
      windowHours: boundedParameter(parameters, "windowHours", DEFAULT_WINDOW_HOURS, 1, MAX_WINDOW_HOURS),
      minMinutes: boundedParameter(parameters, "minMinutes", DEFAULT_MIN_MINUTES, 0, 1_440),
    });

    const payload: EncountersResponse = {
      ...found,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(payload, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isBadRequest = message.includes("must be a number");
    console.error("Unable to load encounters", { error: message });
    return NextResponse.json(
      { error: isBadRequest ? message : "Unable to load encounters" },
      { status: isBadRequest ? 400 : 503 },
    );
  }
}
