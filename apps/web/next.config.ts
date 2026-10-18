import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

// En local las credenciales viven en el `.env` de la raíz del monorepo, que
// Next no lee porque solo mira el directorio de la app. `loadEnvFile` nunca
// sobreescribe variables ya definidas, así que el shell y el panel de Vercel
// mantienen la prioridad. En Vercel ese archivo no existe (está en .gitignore).
const rootEnvironmentFile = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
if (existsSync(rootEnvironmentFile)) {
  process.loadEnvFile(rootEnvironmentFile);
}

const nextConfig: NextConfig = {
  transpilePackages: ["@norway-ship-tracker/db", "@norway-ship-tracker/domain"],
};

export default nextConfig;
