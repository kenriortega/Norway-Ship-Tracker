# Norway Ship Tracker

Seguimiento de barcos en aguas noruegas con el AIS abierto de Kystverket,
distribuido en tiempo real por BarentsWatch.

## Arquitectura

- `apps/web`: Next.js, shadcn/ui, MapLibre y endpoints de consulta. Se despliega
  en Vercel.
- `apps/ingestor`: worker TypeScript persistente que consume el stream AIS y
  escribe en PostgreSQL/PostGIS.
- `packages/domain`: tipos normalizados compartidos.
- `packages/db`: esquema Drizzle, escritura y consultas PostGIS.
- `migrations`: migraciones SQL aplicadas en orden.
- `fixtures/barentswatch`: mensajes NDJSON pequeños para pruebas sin red.
- `apps/backend`, `tools/capture` y `tools/replay`: implementación Rust/NMEA
  conservada como proveedor alternativo experimental.

## Desarrollo local

Requiere Node.js 20 o superior, Docker y npm.

1. Copia `.env.example` como `.env` y completa las credenciales de BarentsWatch.
2. Instala las dependencias desde la raíz:

   ```sh
   npm install
   ```

3. Inicia PostGIS:

   ```sh
   docker compose --env-file .env -f infra/compose.yaml up -d
   ```

4. Aplica las migraciones (es seguro repetir el comando):

   ```sh
   set -a; source .env; set +a
   npm run db:migrate
   ```

5. Inicia el worker en una terminal:

   ```sh
   set -a; source .env; set +a
   npm run dev:ingestor
   ```

6. Inicia Next.js en otra terminal:

   ```sh
   npm run dev:web
   ```

   `apps/web` lee el `.env` de la raíz desde `next.config.ts`, por lo que no
   necesita exportarlo a mano. Las variables ya presentes en el entorno o en el
   panel de Vercel tienen prioridad sobre ese archivo.

La interfaz estará en `http://localhost:3000`, las posiciones en
`GET /api/vessels` y la salud del worker en `http://localhost:3001/health`.

## API de posiciones

`GET /api/vessels` acepta los parámetros `west`, `south`, `east`, `north` y
`limit`. Sin parámetros usa un viewport que cubre Noruega. El límite máximo es
10 000 embarcaciones.

## Validaciones

```sh
npm run typecheck
npm test
npm run lint
npm run build
```

Las pruebas del parser y del normalizador utilizan fixtures locales y no dependen
de BarentsWatch.

## Despliegue

La raíz contiene `vercel.json` para construir `apps/web`. En Vercel debe
configurarse un `DATABASE_URL` con pooling.

El worker se despliega aparte mediante `apps/ingestor/Dockerfile` y necesita:

- `DATABASE_URL`
- `BARENTSWATCH_CLIENT_ID`
- `BARENTSWATCH_CLIENT_SECRET`
- `BARENTSWATCH_SCOPE=ais`

No configures las credenciales AIS en variables públicas de Next.js.

## Fuente y licencia de los datos

Los datos AIS proceden de Kystverket y se distribuyen mediante BarentsWatch. Se
publican bajo la [Norwegian Licence for Open Government Data (NLOD)
2.0](https://data.norge.no/nlod/en/2.0).

> Contiene datos AIS distribuidos por Kystverket bajo NLOD 2.0. Los datos son
> procesados y muestreados por esta aplicación.
