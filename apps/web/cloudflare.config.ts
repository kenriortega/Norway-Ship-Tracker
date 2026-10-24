import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  worker: defineWorker({
    name: "web",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-10-24",
    compatibilityFlags: ["nodejs_compat"],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
        // La cadena de conexión no viaja en el bundle: en local sale de
        // .dev.vars y en producción será un secreto del Worker. Declararla
        // aquí es lo que hace que workerd la exponga en process.env, que es
        // de donde la lee lib/database.ts.
        // Hyperdrive: el pool vive en Cloudflare y el Worker recibe de él
        // una cadena de conexión por petición. Sustituye a DATABASE_URL en
        // producción; la variable se conserva para desarrollo contra una base
        // local.
        HYPERDRIVE: bindings.hyperdrive({
          id: "14fb941a1386475d9515626ebbf2a386",
          // En local el binding no sale a Cloudflare: usa la base de
          // desarrollo. Sin esto, `vite dev` apuntaría a producción desde
          // cualquier portátil, que es justo lo que no se quiere.
          dev: { connectionString: process.env.DATABASE_URL ?? "" },
        }),
        DATABASE_URL: bindings.secret(),
        BARENTSWATCH_CLIENT_ID: bindings.secret(),
        BARENTSWATCH_CLIENT_SECRET: bindings.secret(),
    },
  }),
});
