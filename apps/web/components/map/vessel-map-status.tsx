import { AlertTriangle, Loader2, Radio } from "lucide-react";

interface VesselMapStatusProps {
  status: "loading" | "ready" | "error";
  count: number;
  total: number;
  generatedAt: string | null;
  message: string | null;
  onRetry: () => void;
}

function formatTime(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function VesselMapStatus({
  status,
  count,
  total,
  generatedAt,
  message,
  onRetry,
}: VesselMapStatusProps) {
  if (status === "error") {
    return (
      <div
        role="alert"
        className="pointer-events-auto absolute left-4 top-4 z-10 max-w-sm rounded-2xl border border-red-300/40 bg-red-950/85 px-4 py-3 text-sm text-red-50 shadow-lg backdrop-blur"
      >
        <p className="flex items-center gap-2 font-medium">
          <AlertTriangle className="size-4" aria-hidden="true" />
          No se pudieron cargar las posiciones
        </p>
        <p className="mt-1 text-xs leading-5 text-red-100/80">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-full border border-red-200/40 px-3 py-1 text-xs font-medium transition hover:bg-red-100/10"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div
      aria-live="polite"
      className="absolute left-4 top-4 z-10 inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/55 px-3 py-1.5 text-xs text-slate-100 shadow-lg backdrop-blur"
    >
      {status === "loading" ? (
        <>
          <Loader2 className="size-3.5 animate-spin text-cyan-300" aria-hidden="true" />
          Cargando posiciones…
        </>
      ) : (
        <>
          <Radio className="size-3.5 text-emerald-300" aria-hidden="true" />
          {count === total
            ? `${count.toLocaleString("es-ES")} embarcaciones`
            : `${count.toLocaleString("es-ES")} de ${total.toLocaleString("es-ES")} embarcaciones`}
          {generatedAt ? ` · ${formatTime(generatedAt)}` : null}
        </>
      )}
    </div>
  );
}
