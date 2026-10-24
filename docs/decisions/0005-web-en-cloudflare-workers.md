# ADR 0005: La web pasa a Cloudflare Workers

**Estado:** en curso. El andamiaje está puesto y la compatibilidad probada; la
migración no está terminada.

## Contexto

El destino es un VPS de 1 vCPU y 2 GB compartido con `rails-tracker-monitor`.
Medido, el presupuesto de memoria no da para todo: PostgreSQL y las dos
aplicaciones de Next suman el 60 % de los 2 GB y son lo que no se puede
recortar. Sacar la web de la máquina libera unos 200 MB y, sobre todo, elimina
la restricción de no poder construir Next ahí, que era el cuello de verdad.

El `vercel.json` de la raíz apunta a Vercel, que resuelve lo mismo, pero deja
la base de datos del VPS expuesta a internet para que Vercel la alcance. Con
Cloudflare se puede llegar a ella por un túnel saliente, sin abrir un solo
puerto de entrada en el droplet.

## Decisión

1. **vinext sobre Workers, no Pages ni OpenNext.** Pages solo sirve exportación
   estática y las seis rutas de la API son `force-dynamic` contra PostGIS.
   Cloudflare recomienda hoy vinext como forma por defecto de correr Next.js
   sobre Workers.
2. **El andamiaje convive con Next.** `vinext init` es aditivo: `npm run dev` y
   `npm run build` siguen usando Next, y `dev:vinext` / `build:vinext` son la
   vía nueva. Mientras dure la migración se puede arrancar cualquiera de las
   dos.
3. **Configuración con `cf`, no con Wrangler.** `vinext init --platform=cloudflare`
   generó `cloudflare.config.ts`. No se añade Wrangler al proyecto.
4. **Sin caché.** `--cdn-cache=none`, `--data-cache=none`. Es un mapa de
   posiciones en vivo: servir barcos de hace un minuto es el fallo que este
   producto no puede permitirse. Lo mismo valdrá para la caché de Hyperdrive,
   que viene activada por defecto y hay que apagar.
5. **Sin optimización de imágenes.** La web no usa `next/image`.

## Lo que probó el spike

`vinext check` da **100 % compatible**. Importa: `transpilePackages` sale
soportado, que es lo que bundlea `packages/db` y `packages/domain`, y el
`export const runtime = "nodejs"` de las seis rutas se ignora sin romper nada.

Con el servidor de vinext corriendo sobre workerd contra el PostGIS local, las
siete superficies responden 200: la página, las cinco rutas de consulta y el
proxy del histórico de BarentsWatch.

## Dos cosas que el spike destapó

### Los secretos hay que declararlos en `cloudflare.config.ts`

Poner `DATABASE_URL` en `.dev.vars` no basta: el Worker arranca sin verla y las
rutas devuelven 503. Hay que declararla como binding para que workerd la
exponga en `process.env`, que es de donde la leen `lib/database.ts` y
`lib/barentswatch.ts`.

### `lib/database.ts` cuelga el Worker

Este es el hallazgo que justifica el spike. La primera petición funciona y a
partir de la segunda el runtime la cancela:

> The Workers runtime canceled this request because it detected that your
> Worker's code had hung and would never generate a response.

La causa es el singleton a nivel de módulo:

```ts
connection ??= createDatabase(databaseUrl, 3);
```

En Workers un socket abierto durante una petición no se puede reutilizar en la
siguiente. Ese patrón es correcto en Node y es un cuelgue aquí. Verificado: sin
la caché, cinco peticiones seguidas a rutas distintas responden 200.

De aquí sale que **Hyperdrive no es opcional**. No está solo para poolear: sin
él no hay dónde apoyar la conexión entre peticiones.

## Lo que queda

1. Reescribir `lib/database.ts` para crear el cliente por petición desde el
   binding de Hyperdrive.
2. TLS en el Postgres de `infra-common`, que Hyperdrive exige y hoy no tiene.
3. Túnel y configuración de Hyperdrive, con su caché desactivada.
4. Desplegar, y decidir qué pasa con `vercel.json`.

## Riesgos aceptados

- `@cloudflare/vite-plugin` y `cf` entran en versión **beta**.
- `vinext init` subió React de `19.2.8` fijado a `^19.3.1`. Es un cambio de
  versión menor y de fijado a rango, no solo una adición.
