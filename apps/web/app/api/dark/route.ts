import { getDarkVessels } from "@norway-ship-tracker/db";
import type { DarkVesselsResponse } from "@norway-ship-tracker/domain";
import { NextResponse, type NextRequest } from "next/server";

import { getDatabase } from "@/lib/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_THRESHOLD_MINUTES = 45;
const DEFAULT_MIN_SPEED = 3;

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
  return Math.max(minimum, Math.min(parsed, maximum));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const parameters = request.nextUrl.searchParams;
    const dark = await getDarkVessels(getDatabase(), {
      thresholdMinutes: boundedParameter(parameters, "minutes", DEFAULT_THRESHOLD_MINUTES, 5, 2_880),
      minSpeed: boundedParameter(parameters, "minSpeed", DEFAULT_MIN_SPEED, 0, 50),
    });

    const payload: DarkVesselsResponse = {
      ...dark,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(payload, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isBadRequest = message.includes("must be a number");
    console.error("Unable to load dark vessels", { error: message });
    return NextResponse.json(
      { error: isBadRequest ? message : "Unable to load dark vessels" },
      { status: isBadRequest ? 400 : 503 },
    );
  }
}
