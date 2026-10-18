/**
 * Familias del campo "Ship and cargo type" del mensaje AIS 5. Agrupamos por
 * decenas porque el dígito de la derecha detalla la carga y no aporta a la
 * lectura del mapa. La categoría se calcula una sola vez, al construir el
 * GeoJSON, y la comparten el popup y los filtros.
 */
export const VESSEL_CATEGORIES = [
  "cargo",
  "tanker",
  "passenger",
  "fishing",
  "leisure",
  "service",
  "military",
  "other",
  "unknown",
] as const;

export type VesselCategory = (typeof VESSEL_CATEGORIES)[number];

export const VESSEL_CATEGORY_LABELS: Record<VesselCategory, string> = {
  cargo: "Carga",
  tanker: "Tanque",
  passenger: "Pasaje",
  fishing: "Pesca",
  leisure: "Recreo",
  service: "Servicio",
  military: "Militar",
  other: "Otros",
  unknown: "Sin tipo",
};

export function categorizeShipType(shipType: number | null): VesselCategory {
  if (shipType === null) return "unknown";
  if (shipType === 30) return "fishing";
  if (shipType === 35) return "military";
  if (shipType === 36 || shipType === 37) return "leisure";
  // Remolcadores, dragas, buceo, prácticos, salvamento y servicio portuario.
  if ((shipType >= 31 && shipType <= 34) || (shipType >= 50 && shipType <= 59)) return "service";
  // Las naves de alta velocidad son transporte de pasaje en la práctica.
  if (shipType >= 40 && shipType <= 49) return "passenger";
  if (shipType >= 60 && shipType <= 69) return "passenger";
  if (shipType >= 70 && shipType <= 79) return "cargo";
  if (shipType >= 80 && shipType <= 89) return "tanker";
  return "other";
}

export function isVesselCategory(value: unknown): value is VesselCategory {
  return typeof value === "string" && (VESSEL_CATEGORIES as ReadonlyArray<string>).includes(value);
}
