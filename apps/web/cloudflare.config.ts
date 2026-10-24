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

      // El pool vive en Cloudflare y entrega al Worker una cadena de conexión
      // por petición. Es la fuente en producción; `DATABASE_URL` queda como
      // respaldo para ejecutar fuera de Workers.
      HYPERDRIVE: bindings.hyperdrive({
        id: "14fb941a1386475d9515626ebbf2a386",
        // En local el binding no sale a Cloudflare: usa la base de
        // desarrollo. Sin esto, `vite dev` apuntaría a producción desde
        // cualquier portátil, que es justo lo que no se quiere.
        dev: { connectionString: process.env.DATABASE_URL ?? "" },
      }),

      // Declarar los secretos aquí es lo que hace que workerd los exponga en
      // `process.env`, que es de donde los leen `lib/database.ts` y
      // `lib/barentswatch.ts`. Ponerlos solo en `.dev.vars` no basta.
      DATABASE_URL: bindings.secret(),
      BARENTSWATCH_CLIENT_ID: bindings.secret(),
      BARENTSWATCH_CLIENT_SECRET: bindings.secret(),
    },
  }),
});
