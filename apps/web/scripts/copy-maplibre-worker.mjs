// MapLibre 6 resuelve su worker como `./maplibre-gl-worker.mjs` relativo al
// módulo que lo carga. Empaquetado por Next ese módulo vive en
// `/_next/static/chunks/`, donde el worker no existe, así que lo copiamos a
// `public/` y lo registramos con `setWorkerUrl`. La copia se regenera en cada
// `dev` y `build`, de modo que siempre coincide con la versión instalada.
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(
  dirname(require.resolve("maplibre-gl/package.json")),
  "dist/maplibre-gl-worker.mjs",
);
const target = resolve(appDirectory, "public/maplibre-gl-worker.mjs");

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
