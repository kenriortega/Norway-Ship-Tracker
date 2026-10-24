import type { ActivitySample, CoverageCounts, FreshnessBuckets, TrafficCell } from "@norway-ship-tracker/domain";

import { formatCoordinates, type CategorySlice, type StatusSlice } from "@/lib/stats-view";

function formatInteger(value: number): string {
  return value.toLocaleString("es-ES");
}

function percentage(value: number, total: number): number {
  return total === 0 ? 0 : (value / total) * 100;
}

interface PanelProps {
  title: string;
  hint?: string;
  children: React.ReactNode;
}

export function Panel({ title, hint, children }: PanelProps) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <header className="mb-4">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {hint === undefined ? null : (
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{hint}</p>
        )}
      </header>
      {children}
    </section>
  );
}

interface BarRowProps {
  label: string;
  value: number;
  total: number;
  detail?: string;
}

function BarRow({ label, value, total, detail }: BarRowProps) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[8rem_minmax(0,1fr)_auto]">
      <span className="truncate text-muted-foreground">{label}</span>
      <span className="col-span-2 row-start-2 h-1 overflow-hidden rounded-full bg-secondary sm:col-span-1 sm:row-auto" aria-hidden="true">
        <span
          className="block h-full rounded-full bg-primary"
          style={{ width: `${percentage(value, total)}%` }}
        />
      </span>
      <span className="font-mono tabular-nums font-medium">
        {formatInteger(value)}
        {detail === undefined ? null : (
          <span className="ml-2 font-normal text-muted-foreground">{detail}</span>
        )}
      </span>
    </li>
  );
}

export function CategoryPanel({ categories }: { categories: CategorySlice[] }) {
  const total = categories.reduce((sum, slice) => sum + slice.vessels, 0);

  return (
    <Panel title="Flota por tipo" hint="Entre paréntesis, la velocidad media de los que navegan.">
      <ul className="flex flex-col gap-2">
        {categories.map((slice) => (
          <BarRow
            key={slice.category}
            label={slice.label}
            value={slice.vessels}
            total={total}
            detail={
              slice.averageSpeed === null
                ? undefined
                : `(${slice.averageSpeed.toLocaleString("es-ES", { maximumFractionDigits: 1 })} kn)`
            }
          />
        ))}
      </ul>
    </Panel>
  );
}

export function StatusPanel({ statuses }: { statuses: StatusSlice[] }) {
  const total = statuses.reduce((sum, slice) => sum + slice.vessels, 0);

  return (
    <Panel title="Estado de navegación" hint="Según el estado que declara cada barco por AIS.">
      <ul className="flex flex-col gap-2">
        {statuses.map((slice) => (
          <BarRow key={slice.label} label={slice.label} value={slice.vessels} total={total} />
        ))}
      </ul>
    </Panel>
  );
}

export function ActivityPanel({ activity }: { activity: ActivitySample[] }) {
  if (activity.length < 2) {
    return (
      <Panel title="Actividad AIS">
        <p className="text-sm text-muted-foreground">
          Aún no hay suficiente historial para dibujar la última hora.
        </p>
      </Panel>
    );
  }

  const maximum = Math.max(...activity.map((sample) => sample.positions));
  const width = 100;
  const height = 32;
  const points = activity
    .map((sample, index) => {
      const x = (index / (activity.length - 1)) * width;
      const y = height - (sample.positions / maximum) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const last = activity[activity.length - 1];

  return (
    <Panel title="Actividad AIS" hint="Posiciones recibidas por minuto en la última hora.">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-16 w-full"
        role="img"
        aria-label={`Actividad de la última hora, máximo ${formatInteger(maximum)} posiciones por minuto`}
      >
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          className="text-primary"
        />
      </svg>
      <p className="mt-3 text-sm text-muted-foreground">
        Último minuto: <span className="font-medium text-foreground">{formatInteger(last.positions)}</span>{" "}
        · máximo {formatInteger(maximum)}
      </p>
    </Panel>
  );
}

export function TrafficPanel({ traffic }: { traffic: TrafficCell[] }) {
  const total = traffic.reduce((sum, cell) => Math.max(sum, cell.vessels), 0);

  return (
    <Panel title="Zonas con más tráfico" hint="Celdas de medio grado, ordenadas por embarcaciones.">
      <ul className="flex flex-col gap-2">
        {traffic.map((cell) => (
          <BarRow
            key={`${cell.longitude}:${cell.latitude}`}
            label={formatCoordinates(cell.longitude, cell.latitude)}
            value={cell.vessels}
            total={total}
          />
        ))}
      </ul>
    </Panel>
  );
}

interface FreshnessPanelProps {
  freshness: FreshnessBuckets;
  coverage: CoverageCounts;
}

export function FreshnessPanel({ freshness, coverage }: FreshnessPanelProps) {
  const buckets = [
    { label: "Menos de 5 min", value: freshness.underFiveMinutes },
    { label: "5 min a 1 h", value: freshness.underOneHour },
    { label: "1 h a 6 h", value: freshness.underSixHours },
    { label: "Más de 6 h", value: freshness.older },
  ];
  const total = buckets.reduce((sum, bucket) => sum + bucket.value, 0);

  return (
    <Panel
      title="Frescura de los datos"
      hint="Antigüedad de la última posición conocida de cada barco."
    >
      <ul className="flex flex-col gap-2">
        {buckets.map((bucket) => (
          <BarRow key={bucket.label} label={bucket.label} value={bucket.value} total={total} />
        ))}
      </ul>
      <p className="mt-4 border-t border-border pt-3 text-sm text-muted-foreground">
        Antena terrestre{" "}
        <span className="font-medium text-foreground">{formatInteger(coverage.terrestrial)}</span> ·
        satélite <span className="font-medium text-foreground">{formatInteger(coverage.satellite)}</span>
      </p>
    </Panel>
  );
}

interface StatTilesProps {
  tiles: { label: string; value: number; hint?: string }[];
}

export function StatTiles({ tiles }: StatTilesProps) {
  return (
    <dl aria-label="Resumen de la flota" className="grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-card lg:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="border-border p-4 odd:border-r [&:nth-child(n+3)]:border-t lg:border-r lg:p-5 lg:last:border-r-0 lg:[&:nth-child(n+3)]:border-t-0">
          <dt className="text-sm text-muted-foreground">{tile.label}</dt>
          <dd className="mt-2 text-3xl font-mono font-medium tabular-nums tracking-tight">
            {formatInteger(tile.value)}
          </dd>
          {tile.hint === undefined ? null : (
            <p className="mt-1 text-sm text-muted-foreground">{tile.hint}</p>
          )}
        </div>
      ))}
    </dl>
  );
}
