import { VesselDashboard } from "@/components/dashboard/vessel-dashboard";
import { VesselMap } from "@/components/map/vessel-map";
import { Badge } from "@/components/ui/badge";

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:py-12">
        <header className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <Badge variant="secondary">Primer hito · BarentsWatch</Badge>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
              Norway Ship Tracker
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
              Del stream AIS de BarentsWatch a un mapa de Noruega, con TypeScript,
              Drizzle, PostgreSQL/PostGIS y Next.js.
            </p>
          </div>
          <Badge variant="outline" className="w-fit border-emerald-500/40 text-emerald-700">
            Posiciones en vivo
          </Badge>
        </header>

        <VesselMap />

        <div className="mt-8">
          <VesselDashboard />
        </div>

        <footer className="mt-10 border-t border-border pt-5 text-xs leading-5 text-muted-foreground">
          Contiene datos AIS distribuidos por Kystverket bajo NLOD 2.0. Los datos serán
          procesados y muestreados por esta aplicación. Distribución en tiempo real a
          través de BarentsWatch.
        </footer>
      </div>
    </main>
  );
}
