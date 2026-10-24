# Imagen de la web.
#
# El contexto de build es la raíz del repositorio y no `apps/web`: Next
# necesita los paquetes del workspace (`packages/db`, `packages/domain`), que
# `transpilePackages` mete en el bundle.
#
# Se construye con `--platform linux/amd64` desde un Mac con Apple Silicon.
# Es JavaScript, así que la salida es portable, pero la imagen base del
# runtime sí tiene arquitectura y el droplet es amd64.

FROM node:22-alpine AS build

WORKDIR /repo

# Dependencias en su propia capa: tocar código no vuelve a instalarlas.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/barentswatch/package.json packages/barentswatch/package.json

# Se resuelve sin lockfile, a regañadientes y con motivo.
#
# El lockfile se generó en un Mac y npm solo anotó las dependencias opcionales
# de esa plataforma: de `@tailwindcss/oxide` existe únicamente la entrada
# `darwin-arm64`. Tailwind v4 necesita ese binario nativo para procesar el CSS,
# así que en Linux el build muere compilando `globals.css`.
#
# Probado y descartado: `npm ci` falla igual; `npm install` con el lockfile
# presente respeta sus opcionales y falla también; `npm install --os=linux
# --cpu=x64 --package-lock-only` añade las variantes de `sharp` pero no las de
# `oxide`. El propio mensaje de npm pide quitar el lockfile, y es lo único que
# funciona.
#
# El coste es real: dentro de la imagen las versiones se resuelven de nuevo y
# pueden derivar respecto a lo probado en local. El arreglo de verdad es
# generar el lockfile en Linux (en CI) para que conozca las dos plataformas.
RUN rm -f package-lock.json && npm install --no-audit --no-fund

COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web

# `prebuild` copia el worker de MapLibre a public/; sin él el mapa carga pero
# no encuentra su worker y se queda sin teselas.
RUN npm run build --workspace @norway-ship-tracker/web

# El runtime lleva solo lo que Next empaquetó: unos 83 MB en vez de los 387
# de node_modules.
FROM node:22-alpine AS runtime

WORKDIR /app

# `node` ya existe en la imagen base con uid 1000. Correr como root un
# servidor que atiende peticiones no tiene ninguna ventaja.
USER node

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# El standalone conserva la estructura del monorepo, de ahí los `apps/web`.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
