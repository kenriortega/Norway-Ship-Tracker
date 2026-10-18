import { Anchor, Radio } from "lucide-react";

export function VesselMap() {
  return (
    <section
      aria-label="Área reservada para el mapa de barcos"
      className="relative flex min-h-[480px] overflow-hidden rounded-3xl border border-white/10 bg-[#071a2c] shadow-2xl"
    >
      <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(85,184,219,.13)_1px,transparent_1px),linear-gradient(90deg,rgba(85,184,219,.13)_1px,transparent_1px)] [background-size:42px_42px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_65%_35%,rgba(30,148,190,.28),transparent_32%),radial-gradient(circle_at_32%_70%,rgba(23,92,125,.35),transparent_30%)]" />

      <div className="relative m-auto max-w-md px-8 text-center">
        <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200">
          <Anchor className="size-8" aria-hidden="true" />
        </div>
        <p className="text-sm font-medium uppercase tracking-[0.24em] text-cyan-200/70">
          Norway · 64.5° N, 11° E
        </p>
        <h2 className="mt-3 text-3xl font-semibold text-white">Mapa listo para recibir AIS</h2>
        <p className="mt-4 text-sm leading-6 text-slate-300">
          Esta superficie será alimentada por snapshots PostGIS consultados desde la API
          de Next.js desplegada en Vercel.
        </p>
        <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-slate-300">
          <Radio className="size-3.5 text-amber-300" aria-hidden="true" />
          Esperando posiciones de PostGIS
        </div>
      </div>
    </section>
  );
}

