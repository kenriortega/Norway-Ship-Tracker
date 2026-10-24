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

**Arreglado.** `getDatabase()` pasó a ser `withDatabase(work)`, que abre una
conexión, ejecuta y la cierra en un `finally`. El cierre no es cosmético:
sin él se cambia el cuelgue por una fuga de un socket por petición. Las cinco
rutas que consultaban la base pasan ahora por ahí. Verificado con quince
peticiones seguidas a las cinco rutas: todas 200, con datos, y las trazas del
runtime en `ok`.

## Cómo se conectó a la base

Hyperdrive ofrece tres formas de alcanzar el origen: público sin restricción,
público restringido por lista de IPs, o red privada por túnel. **Se eligió la
segunda**, y no por preferencia técnica: la tercera exige proteger el túnel con
Cloudflare Access, y Access exige activar Zero Trust, que pide una tarjeta.

Así que Postgres publica su puerto y el filtro se hace por origen:

- En el cortafuegos de DigitalOcean, los 15 rangos IPv4 publicados de
  Cloudflare, que es por donde sale Hyperdrive.
- En la cadena `DOCKER-USER` del droplet, los 22 rangos, persistidos con
  `iptables-persistent`. **Esta capa no es redundante**: Docker inserta sus
  reglas de iptables antes que las de `ufw`, así que un puerto publicado sería
  alcanzable pese a lo que diga `ufw`. `DOCKER-USER` es la única cadena que
  Docker respeta.

Lo que se pierde está dicho: el droplet deja de escuchar solo por el 22. Lo
que protege de verdad sigue siendo el TLS y una contraseña de 24 bytes
aleatorios, igual que en Neon o Supabase, con el filtro de origen como capa
extra. Esos rangos los puede cambiar Cloudflare, y entonces habrá que
actualizarlos en los dos sitios.

## El binding en local

El binding de Hyperdrive exige un `dev.connectionString`. No es un requisito
molesto: sin él, `vite dev` apuntaría a la base de producción desde cualquier
portátil. En local sale de `DATABASE_URL`.

## Lo que queda

1. Desplegar el Worker: `npm run deploy:vinext`.
2. Decidir qué pasa con `vercel.json`, que queda obsoleto.
3. El túnel `trackers-pg` y su `cloudflared` siguen levantados pero ya no
   hacen falta para la base. Se mantienen por si la web acaba sirviéndose
   desde el droplet; si no, se retiran y son 30 MB menos.

## Riesgos aceptados

- `@cloudflare/vite-plugin` y `cf` entran en versión **beta**.
- `vinext init` subió React de `19.2.8` fijado a `^19.3.1`. Es un cambio de
  versión menor y de fijado a rango, no solo una adición.
- En desarrollo, workerd registra `eval() is not supported in this
  environment. React requires eval() in development mode`. La página sirve
  igual, en 200, pero conviene saber que ese aviso sale y no es un fallo de la
  aplicación.
- Abrir y cerrar una conexión por petición cuesta latencia frente al singleton
  que había. Es el precio de que funcione, y con Hyperdrive delante la conexión
  pasa a ser contra su proxy local, que es barata.
