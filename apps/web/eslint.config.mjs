import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  // `public/maplibre-gl-worker.mjs` es una copia generada de una dependencia.
  globalIgnores([".next/**", ".cloudflare/**", "dist/**", "out/**", "build/**", "next-env.d.ts", "public/**"]),
]);

