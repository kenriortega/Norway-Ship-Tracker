import { Anchor, Waves } from "lucide-react";

import { VesselDashboard } from "@/components/dashboard/vessel-dashboard";
import { VesselMap } from "@/components/map/vessel-map";
import { Badge } from "@/components/ui/badge";

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-8">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-lg border border-primary/40 bg-primary/10 text-primary">
              <Anchor className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-base font-semibold tracking-tight">Norway Ship Tracker<span className="text-primary">.</span></p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">KYSTVERKET · BARENTSWATCH</p>
            </div>
          </div>
          <Badge variant="outline" className="gap-2 text-muted-foreground">
            <Waves className="size-3.5 text-primary" aria-hidden="true" />
            Seguimiento AIS
          </Badge>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-8 sm:py-8">
        <div className="mb-6">
          <p className="eyebrow">Centro de operaciones · Noruega</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-tight sm:text-[32px]">
            Una perspectiva <span className="text-primary">marítima.</span>
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Posiciones AIS y actividad marítima en aguas noruegas.
          </p>
        </div>

        <VesselDashboard>
          <VesselMap />
        </VesselDashboard>

        <footer className="mt-8 border-t border-border pt-5 text-xs leading-6 text-muted-foreground">
          Contiene datos AIS distribuidos por Kystverket bajo NLOD 2.0. Los datos serán
          procesados y muestreados por esta aplicación. Distribución en tiempo real a
          través de BarentsWatch.
        </footer>
      </div>
    </main>
  );
}
