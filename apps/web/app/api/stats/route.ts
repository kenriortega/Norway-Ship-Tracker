import { getVesselStats } from "@norway-ship-tracker/db";
import type { VesselStatsResponse } from "@norway-ship-tracker/domain";
import { NextResponse } from "next/server";

import { getDatabase } from "@/lib/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    const stats = await getVesselStats(getDatabase());
    const payload: VesselStatsResponse = {
      ...stats,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(payload, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Unable to load vessel statistics", { error: message });
    return NextResponse.json({ error: "Unable to load vessel statistics" }, { status: 503 });
  }
}
