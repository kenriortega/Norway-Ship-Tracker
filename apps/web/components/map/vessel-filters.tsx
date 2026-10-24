"use client";

import { Slider } from "@/components/ui/slider";
import { VESSEL_CATEGORIES, VESSEL_CATEGORY_LABELS, type VesselCategory } from "@/lib/vessel-types";

interface VesselFiltersProps {
  open: boolean;
  onToggle: () => void;
  selectedCategories: ReadonlySet<VesselCategory>;
  minSpeed: number;
  onToggleCategory: (category: VesselCategory) => void;
  onMinSpeedChange: (minSpeed: number) => void;
  onReset: () => void;
  isFiltered: boolean;
}

export const MAX_MIN_SPEED_KNOTS = 20;

export function VesselFilters({
  open,
  onToggle,
  selectedCategories,
  minSpeed,
  onToggleCategory,
  onMinSpeedChange,
  onReset,
  isFiltered,
}: VesselFiltersProps) {
  return (
    <div className="map-tool map-tool-filters text-sm">
      <button type="button" className="map-tool-toggle" aria-expanded={open} aria-controls="vessel-filters" onClick={onToggle}>Filtros</button>
      <div id="vessel-filters" className="map-tool-panel" data-open={open}>
        <div className="flex items-center justify-between">
          <p className="font-medium">Filtros</p>
          {isFiltered ? (
            <button
              type="button"
              onClick={onReset}
              className="map-action text-xs"
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
                      ? "map-action border-primary bg-primary/15 text-xs text-primary"
                      : "map-action text-xs text-muted-foreground"
                  }
                >
                  {VESSEL_CATEGORY_LABELS[category]}
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="mt-3 flex items-baseline justify-between" htmlFor="min-speed">
          <span className="text-muted-foreground">Desde</span>
          <span className="font-mono font-medium">
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
    </div>
  );
}
