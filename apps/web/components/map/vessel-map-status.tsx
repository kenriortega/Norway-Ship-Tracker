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
        className="pointer-events-auto absolute left-3 right-16 top-3 z-20 max-w-sm max-h-48 overflow-auto rounded-lg border border-danger/60 bg-card px-4 py-3 text-sm text-danger shadow-lg"
      >
        <p className="flex items-center gap-2 font-medium">
          <AlertTriangle className="size-4" aria-hidden="true" />
          No se pudieron cargar las posiciones
        </p>
        <p className="mt-1 text-xs leading-5 text-danger">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 map-action border-danger/60 text-xs font-medium hover:bg-danger/10"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div
      aria-live="polite"
      className="absolute left-3 right-16 top-3 z-10 flex max-w-fit items-center gap-2 rounded-md border border-control-border bg-card px-3 py-2 text-xs text-foreground shadow-lg sm:right-auto"
    >
      {status === "loading" ? (
        <>
          <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden="true" />
          Cargando posiciones…
        </>
      ) : (
        <>
          <Radio className="size-3.5 text-success" aria-hidden="true" />
          <span>
          {count === total
            ? `${count.toLocaleString("es-ES")} embarcaciones`
            : `${count.toLocaleString("es-ES")} de ${total.toLocaleString("es-ES")} embarcaciones`}
          {generatedAt ? ` · Actualizado ${formatTime(generatedAt)}` : null}
          </span>
        </>
      )}
    </div>
  );
}
