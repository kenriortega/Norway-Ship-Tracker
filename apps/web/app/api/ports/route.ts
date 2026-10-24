import { getPortClusters } from "@norway-ship-tracker/db";
import type { PortClustersResponse } from "@norway-ship-tracker/domain";
import { NextResponse, type NextRequest } from "next/server";

import { withDatabase } from "@/lib/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_EPS_METERS = 1_500;
const DEFAULT_MIN_VESSELS = 4;
const DEFAULT_WINDOW_HOURS = 24;
// El histórico se purga a los tres días completos más el día en curso, así que
// garantiza 72 h a cualquier hora. Pedir más devolvería una respuesta
// incompleta sin avisar, que es peor que un parámetro acotado.
const MAX_WINDOW_HOURS = 72;

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
    const clusters = await withDatabase((database) =>
      getPortClusters(database, {
        epsMeters: boundedParameter(parameters, "eps", DEFAULT_EPS_METERS, 100, 20_000),
        minVessels: boundedParameter(parameters, "minVessels", DEFAULT_MIN_VESSELS, 2, 100),
        windowHours: boundedParameter(parameters, "windowHours", DEFAULT_WINDOW_HOURS, 1, MAX_WINDOW_HOURS),
      }),
    );

    const payload: PortClustersResponse = {
      ...clusters,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(payload, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isBadRequest = message.includes("must be a number");
    console.error("Unable to load port clusters", { error: message });
    return NextResponse.json(
      { error: isBadRequest ? message : "Unable to load port clusters" },
      { status: isBadRequest ? 400 : 503 },
    );
  }
}
