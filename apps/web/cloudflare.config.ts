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
        DATABASE_URL: bindings.secret(),
        BARENTSWATCH_CLIENT_ID: bindings.secret(),
        BARENTSWATCH_CLIENT_SECRET: bindings.secret(),
    },
  }),
});
