import { getLatestVessels, type VesselBounds } from "@norway-ship-tracker/db";
import type { VesselPositionsResponse } from "@norway-ship-tracker/domain";
import { NextResponse, type NextRequest } from "next/server";

import { withDatabase } from "@/lib/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NORWAY_BOUNDS: VesselBounds = {
  west: 3,
  south: 56,
  east: 32,
  north: 72,
};

function numberParameter(
  parameters: URLSearchParams,
  name: string,
  fallback: number,
): number {
  const raw = parameters.get(name);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`);
  return parsed;
}

function parseBounds(parameters: URLSearchParams): VesselBounds {
  const bounds = {
    west: numberParameter(parameters, "west", NORWAY_BOUNDS.west),
    south: numberParameter(parameters, "south", NORWAY_BOUNDS.south),
    east: numberParameter(parameters, "east", NORWAY_BOUNDS.east),
    north: numberParameter(parameters, "north", NORWAY_BOUNDS.north),
  };

  if (
    bounds.west < -180 ||
    bounds.east > 180 ||
    bounds.south < -90 ||
    bounds.north > 90 ||
    bounds.west >= bounds.east ||
    bounds.south >= bounds.north
  ) {
    throw new Error("Invalid viewport bounds");
  }

  return bounds;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const bounds = parseBounds(request.nextUrl.searchParams);
    const requestedLimit = numberParameter(request.nextUrl.searchParams, "limit", 5_000);
    const limit = Math.max(1, Math.min(Math.trunc(requestedLimit), 10_000));
    const vessels = await withDatabase((database) =>
      getLatestVessels(database, bounds, limit),
    );
    const payload: VesselPositionsResponse = {
      vessels,
      count: vessels.length,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(payload, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isBadRequest = message.includes("bounds") || message.includes("must be a number");
    console.error("Unable to load vessel positions", { error: message });
    return NextResponse.json(
      { error: isBadRequest ? message : "Unable to load vessel positions" },
      { status: isBadRequest ? 400 : 503 },
    );
  }
}
