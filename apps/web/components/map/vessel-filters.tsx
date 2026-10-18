"use client";

import { Slider } from "@/components/ui/slider";
import { VESSEL_CATEGORIES, VESSEL_CATEGORY_LABELS, type VesselCategory } from "@/lib/vessel-types";

interface VesselFiltersProps {
  selectedCategories: ReadonlySet<VesselCategory>;
  minSpeed: number;
  onToggleCategory: (category: VesselCategory) => void;
  onMinSpeedChange: (minSpeed: number) => void;
  onReset: () => void;
  isFiltered: boolean;
}

export const MAX_MIN_SPEED_KNOTS = 20;

export function VesselFilters({
  selectedCategories,
  minSpeed,
  onToggleCategory,
  onMinSpeedChange,
  onReset,
  isFiltered,
}: VesselFiltersProps) {
  return (
    <div className="absolute left-4 top-16 z-10 w-60 rounded-2xl border border-white/15 bg-black/60 p-3 text-xs text-slate-100 shadow-lg backdrop-blur">
      <div className="flex items-center justify-between">
        <p className="font-medium">Filtros</p>
        {isFiltered ? (
          <button
            type="button"
            onClick={onReset}
            className="rounded-full border border-white/20 px-2 py-0.5 text-[11px] transition hover:bg-white/10"
          >
            Quitar
          </button>
        ) : null}
      </div>

      <fieldset className="mt-2">
        <legend className="sr-only">Tipo de embarcación</legend>
        <div className="flex flex-wrap gap-1">
          {VESSEL_CATEGORIES.map((category) => {
            const isSelected = selectedCategories.has(category);

            return (
              <button
                key={category}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onToggleCategory(category)}
                className={
                  isSelected
                    ? "rounded-full border border-cyan-300/60 bg-cyan-400/20 px-2 py-0.5 text-[11px] text-cyan-100 transition"
                    : "rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-slate-400 transition hover:bg-white/10"
                }
              >
                {VESSEL_CATEGORY_LABELS[category]}
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="mt-3 flex items-baseline justify-between" htmlFor="min-speed">
        <span className="text-slate-300">Desde</span>
        <span className="font-medium">
          {minSpeed.toLocaleString("es-ES")} {minSpeed === 1 ? "nudo" : "nudos"}
        </span>
      </label>
      <Slider
        id="min-speed"
        className="mt-2"
        value={[minSpeed]}
        min={0}
        max={MAX_MIN_SPEED_KNOTS}
        step={1}
        onValueChange={(values: number[]) => onMinSpeedChange(values[0] ?? 0)}
        aria-label="Velocidad mínima en nudos"
      />
    </div>
  );
}
