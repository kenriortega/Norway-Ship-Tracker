// La flecha apunta al norte (0°) en coordenadas normalizadas [-1, 1]; MapLibre
// la gira en sentido horario con `icon-rotate`. Es un dardo, no un triángulo:
// la muesca trasera deja claro cuál es la proa incluso a 12 px.
const ARROW: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0.62, 0.78],
  [0, 0.38],
  [-0.62, 0.78],
];

const SIZE_PX = 32;
const PIXEL_RATIO = 2;
// Cuántos píxeles abarca la rampa del campo de distancia a cada lado del
// contorno. Menos la vuelve dentada; más, difusa.
const SPREAD_PX = 4;

function distanceToSegment(
  x: number,
  y: number,
  [ax, ay]: readonly [number, number],
  [bx, by]: readonly [number, number],
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / lengthSquared));

  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

function isInside(
  x: number,
  y: number,
  polygon: ReadonlyArray<readonly [number, number]>,
): boolean {
  let inside = false;

  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [xi, yi] = polygon[index];
    const [xj, yj] = polygon[previous];
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }

  return inside;
}

/**
 * MapLibre interpreta el canal alfa de un icono SDF como un campo de distancia
 * con el contorno en 0,5, lo que permite teñirlo con `icon-color` y darle halo
 * desde el estilo en lugar de generar un PNG por cada color.
 */
export function createArrowIcon(): {
  width: number;
  height: number;
  data: Uint8Array;
} {
  const data = new Uint8Array(SIZE_PX * SIZE_PX * 4);
  const half = SIZE_PX / 2;
  // Dejamos margen para que la rampa quepa dentro del icono.
  const radius = half - SPREAD_PX / 2;

  const polygon = ARROW.map(
    ([x, y]) => [half + x * radius, half + y * radius] as readonly [number, number],
  );

  for (let y = 0; y < SIZE_PX; y += 1) {
    for (let x = 0; x < SIZE_PX; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;

      let distance = Number.POSITIVE_INFINITY;
      for (
        let index = 0, previous = polygon.length - 1;
        index < polygon.length;
        previous = index++
      ) {
        distance = Math.min(distance, distanceToSegment(px, py, polygon[previous], polygon[index]));
      }

      const signed = isInside(px, py, polygon) ? -distance : distance;
      const alpha = Math.min(1, Math.max(0, 0.5 - signed / (2 * SPREAD_PX)));

      const offset = (y * SIZE_PX + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(alpha * 255);
    }
  }

  return { width: SIZE_PX, height: SIZE_PX, data };
}

export const ARROW_ICON_PIXEL_RATIO = PIXEL_RATIO;
