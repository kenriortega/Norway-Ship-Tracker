# ADR 0006: La web vuelve al VPS

**Estado:** aceptada. Aplicada el 24 de octubre de 2026.

## Contexto

La web se desplegó en Cloudflare Workers (ADR 0005) y funcionó: las siete
superficies respondiendo, Hyperdrive conectando con el Postgres del droplet a
través de un filtro de IPs. Duró un día.

Al crecer los datos empezó a devolver **error 1102, "Worker exceeded resource
limits"**. El plan gratuito de Workers da **10 ms de CPU por petición**, y la
documentación aclara que esperar a la base no cuenta: lo que cuenta es el
JavaScript.

Medido con la base ya llena:

| | |
|---|---|
| La consulta pesada de `/api/dark` | **285 ms** en Postgres |
| Filas en el histórico | 1,54 M, frente a 18 mil el día anterior |
| `/api/dark` por HTTP | 60 s, o 1102 |

La base está sana. Lo que no cabe es serializar 4.300 barcos en 10 ms de CPU:
un `.map()` con conversiones fila a fila y 56 KB de JSON. El día del despliegue
cabía porque había mil veces menos datos.

Subir a Workers de pago (5 $/mes) lo resolvería sin tocar código. **Se
descarta por coste**: son proyectos de demostración y no se quiere añadir otra
suscripción.

## Decisión

La web pasa a correr como contenedor en el mismo droplet que la base, detrás
de un túnel de Cloudflare.

```
Navegador → Cloudflare → túnel (saliente) → VPS
                                             ├── web (Next)
                                             ├── postgres
                                             └── ships-ingestor
```

El túnel vuelve, pero transportando **HTTP de una web pública**, no Postgres en
crudo. Por eso no necesita Access, y por tanto tampoco Zero Trust, que es lo
que pedía tarjeta y bloqueó esa vía la primera vez.

### Lo que se retira con esto

No es solo mover la web de sitio. Desaparecen cuatro piezas:

| Se va | Por qué |
|---|---|
| Hyperdrive | la web habla con `postgres:5432` por la red interna |
| El 5432 publicado | el droplet vuelve a escuchar solo por el 22 |
| Los rangos de Cloudflare en el cortafuegos de DigitalOcean | ya no entra nadie de fuera |
| Las reglas de `DOCKER-USER` | sobran con el puerto cerrado |

De una cadena de seis eslabones a una de tres. Y deja de haber una lista de
rangos que mantener el día que Cloudflare la cambie.

### Decisiones de la imagen

- **`output: "standalone"`.** Sin él la imagen cargaría los 387 MB de
  `node_modules` del workspace. Con él, 81 MB.
- **Se construye fuera del droplet**, con `--platform linux/amd64`, y se
  publica en el mismo registro que el worker. Construir Next en 1 vCPU es
  pedir un OOM.
- **Corre como `node`, no como root**, y con límite de 512 MB, por la misma
  razón que el resto: que el OOM killer no elija a Postgres.
- **Se retira el `webpack` del `next.config.ts`**, que existía solo para que
  `cloudflare:workers` no rompiera el build y además chocaba con Turbopack.
  `lib/database.ts` vuelve a leer `DATABASE_URL` a secas.

## Presupuesto

Medido en el droplet antes de empezar: 777 MB en uso de 1.967.

| | Usado | Libre |
|---|---|---|
| Con la web y el túnel | 1.027 MB | 940 MB |
| Y con rails más adelante | 1.327 MB | 640 MB |

Cabe con holgura, y hay 4 GB de swap debajo.

## Lo que se pierde

La web deja de ejecutarse en el borde: corre en Nueva York, junto a la base.
Para un visor de tráfico marítimo noruego consultado por una persona, la
diferencia no es perceptible. Si algún día importa, el camino de Workers está
hecho y probado.

## Qué pasa con el trabajo de Workers

**Se conserva en el repositorio**: vinext, `cloudflare.config.ts`, los scripts
`*:vinext`. No está en uso, pero el ADR 0005 documenta que funcionó y por qué
se retiró. Borrarlo dejaría la pregunta "¿por qué no está en el borde?" sin
respuesta en el código.

## Qué quedó hecho

La web corre en el droplet y `ships.kenridev.xyz` sale por el túnel desde el
24 de octubre de 2026. El Worker sigue desplegado en
`web.kenriortega-af8.workers.dev` y el código de Workers sigue en el
repositorio, así que la vuelta atrás existe; lo que ya no existe es
Hyperdrive, que habría que volver a crear:

| | |
|---|---|
| Nombre | `trackers-ships` |
| Origen | `pg.kenridev.xyz:5432`, base `trackers`, rol `ships_app` |
| Límite de conexiones | 20 |
| Caché | desactivada |

De la limpieza quedan dos cabos sueltos, los dos en el panel:

| Pieza | |
|---|---|
| Hyperdrive | retirada |
| El 5432 publicado | retirado; el droplet escucha solo por el 22 |
| Las reglas de `DOCKER-USER` | retiradas (IPv4 e IPv6), con copia en `/root/iptables-rules.v*.antes-adr0006` |
| Los rangos de Cloudflare en el cortafuegos de DigitalOcean | **pendiente** |
| El registro DNS `pg.kenridev.xyz` | **pendiente** |

Las dos pendientes son inofensivas mientras el puerto esté cerrado —no hay
nada escuchando a lo que dejar entrar—, pero conviene retirarlas para que la
configuración no describa una topología que ya no existe.
