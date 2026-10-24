# Norway Ship Tracker

Seguimiento de barcos en aguas noruegas con el AIS abierto de Kystverket,
distribuido en tiempo real por BarentsWatch.

## Arquitectura

- `apps/web`: Next.js, shadcn/ui, MapLibre y endpoints de consulta. Se despliega
  en Vercel.
- `apps/ingestor-go`: worker Go persistente que consume el stream AIS y escribe
  en PostgreSQL/PostGIS. Ver [ADR 0004](docs/decisions/0004-ingestor-en-go.md).
- `packages/domain`: tipos normalizados compartidos.
- `packages/db`: consultas PostGIS para la web y el runner de migraciones.
- `migrations`: migraciones SQL aplicadas en orden.
- `fixtures/barentswatch`: mensajes NDJSON pequeños para pruebas sin red.
- `apps/backend`, `tools/capture` y `tools/replay`: implementación Rust/NMEA
  conservada como proveedor alternativo experimental.

## Desarrollo local

Requiere Node.js 20 o superior, Go 1.25 o superior, Docker y npm.

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

   El atajo entra en `apps/ingestor-go`, compila el binario en `bin/` y lo
   ejecuta. Compila en lugar de usar `go run` porque `go run` lanza el worker
   como proceso hijo y no le reenvía las señales: un Ctrl+C mataría al wrapper
   y dejaría al worker ingiriendo.

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

La web y los paquetes compartidos:

```sh
npm run typecheck
npm run lint
npm run build
```

El worker, que es donde viven las pruebas del parser, el normalizador y el
camino de escritura:

```sh
cd apps/ingestor-go && go test ./...
```

Ninguna depende de una conexión con BarentsWatch: el parser y el normalizador
usan los fixtures de `fixtures/barentswatch`, el transporte usa servidores HTTP
de prueba y las de integración se saltan sin `SHIPS_TEST_DATABASE_URL`.

## El worker

`apps/ingestor-go` mantiene el stream AIS y lo persiste. Es un módulo Go propio,
fuera de los workspaces de npm:

```sh
cd apps/ingestor-go
go test ./...
go run ./cmd/ingestor
```

Lee el `.env` de la raíz a través del entorno y expone `/health` en su propio
puerto. En marcha ocupa unos 13 MB de RSS y su imagen son 10,5 MB.

Las pruebas de integración necesitan PostgreSQL con PostGIS y el esquema ya
migrado. Sin `SHIPS_TEST_DATABASE_URL` se saltan:

```sh
SHIPS_TEST_DATABASE_URL=postgres://... go test ./...
```

## Despliegue

La raíz contiene `vercel.json` para construir `apps/web`. En Vercel debe
configurarse un `DATABASE_URL` con pooling.

El worker se despliega aparte mediante `apps/ingestor-go/Dockerfile`, cuyo
contexto de build es ese directorio, y necesita:

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
