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
  // `cloudflare:workers` solo existe dentro de workerd. Webpack no sabe qué
  // hacer con ese esquema y rompe el build de Next, aunque el import sea
  // dinámico y esté dentro de un try. Declararlo externo deja que falle en
  // tiempo de ejecución, que es donde el try lo recoge y cae a DATABASE_URL.
  webpack(config) {
    config.externals = [...(config.externals ?? []), "cloudflare:workers"];
    return config;
  },
};

export default nextConfig;
