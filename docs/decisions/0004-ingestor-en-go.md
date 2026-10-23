# ADR 0004: Ingestor en Go

**Estado:** aceptado. `apps/ingestor` se retiró sin esperar a la medida con
tráfico real; ver *Cómo se cerró* al final.

## Contexto

El destino previsto es un VPS de 1 vCPU y 2 GB de RAM compartido con
`rails-tracker-monitor`. Medido en esa máquina, el presupuesto de memoria sale
así:

| Proceso | RSS |
|---|---|
| PostgreSQL + PostGIS | 500-600 MB |
| ships ingestor | ~120 MB |
| rails consumer | ~150 MB |
| rails projection | ~150 MB |
| ships web + rails web | ~400 MB |
| **Total con el SO** | **~1,6 GB de 2 GB** |

Los dos cuellos son Postgres y las dos aplicaciones de Next, que suman el 60 %
y no se mueven. Los workers son el 26 % y sí.

El ingestor de ships es además el candidato limpio para probarlo: su frontera
con el resto ya estaba donde hacía falta. El ingestor importa de `packages/db`
cuatro símbolos (`createDatabase`, `persistVesselUpdate`,
`applyHistoryRetention`, `closeDatabase`) y la web importa otros cinco, todos
de lectura. **No comparten ni una función.** `packages/domain` en ships son
interfaces de DTO, no lógica: no hay nada que duplicar.

## Decisión

1. **`apps/ingestor-go` sustituye a `apps/ingestor`.** La decisión original era
   que convivieran hasta tener medida; se cambió antes de llegar a ella.
2. **`pgx/v5` sin ORM.** Las tres sentencias de escritura ya eran SQL crudo en
   TypeScript; solo el upsert de `vessels` usaba Drizzle y se escribió a mano.
3. **La retención sigue en SQL.** El Go llama a
   `maintain_vessel_positions_partitions`, que creó la migración 0003. El "qué"
   sigue versionado junto al esquema y el Go solo decide el "cuándo"; por eso
   esa parte del port son veinte líneas y no doscientas.
4. **Las migraciones se quedan en TypeScript.** Portarlas a `golang-migrate`
   daría dos registros de migración sobre las mismas tablas. El esquema
   necesita un solo dueño.
5. **`/health` mantiene el contrato campo por campo**, incluido el formato de
   las marcas de tiempo. Es el contrato observable del worker y la herramienta
   para comparar las dos implementaciones en caliente.
6. **Las escrituras van en serie.** Ver más abajo.

## Alternativas consideradas

### Reducir memoria sin reescribir

Los workers corren con `tsx`, que mantiene el compilador de TypeScript en
memoria en producción. Compilar a JS en el build y ejecutar `node` pelado, más
un `--max-old-space-size` ajustado, recupera parte del ahorro por un día de
trabajo en lugar de un port.

**Sigue siendo lo primero que habría que hacer si el objetivo fuera solo la
memoria.** Este port se acepta como piloto para medir el coste real de
mantener Go en el repositorio, no como la vía barata al presupuesto de RAM.

### Portar también el ingestor de rails

Descartado por ahora. Son cinco programas, no uno, y `@rails/domain` sí está
genuinamente compartido entre ingestor y web: portarlo obligaría a mantener dos
implementaciones de la conversión de hora de pared de Londres, que es el código
más delicado de aquel repositorio. Rails solo tiene sentido portarlo entero.

### Reemplazar directamente el ingestor de TypeScript

Descartado. No deja marcha atrás ni forma de comparar. El repositorio ya tiene
un precedente de camino alternativo que se construyó y quedó sin mantener: el
backend Rust de `apps/backend`. Conviene que la convivencia tenga un criterio
de salida explícito y no se eternice.

## Consecuencias

### Lo que se gana

| | TypeScript | Go |
|---|---|---|
| RSS en marcha | ~120 MB | **13,3 MB** |
| Imagen | ~400 MB | **10,5 MB** |
| Dependencias de producción | el árbol de npm | `pgx` y la biblioteca estándar |

La imagen final es `scratch`: ni shell, ni gestor de paquetes, ni root. Lo
único que lleva además del binario son los certificados raíz, sin los cuales el
TLS contra BarentsWatch falla.

### Lo que cuesta

Dos implementaciones del mismo worker mientras dure la convivencia. Todo cambio
en el normalizador, en el esquema de escritura o en el contrato de `/health`
hay que hacerlo dos veces, y nada obliga a ello salvo la disciplina. Ese es el
coste que este piloto existe para medir.

### Las escrituras tienen que ir en serie

La inserción en `vessel_positions` se protege con
`WHERE NOT EXISTS (... received_at >= cutoff)`. Eso implementa el muestreo de
una posición por barco y ventana, que es lo que sostiene el presupuesto de
disco de la ADR 0003.

Funciona porque las escrituras van en serie. Dos transacciones concurrentes
pueden pasar la comprobación a la vez e insertar dos filas de la misma ventana,
y el fallo no se vería: no hay error, solo un histórico que crece más rápido de
lo presupuestado. **Si algún día hace falta paralelizar, esto necesita una
guarda real y no un pool de escritores.**

### Diferencias de comportamiento deliberadas

- **`msgtime` se exige en RFC 3339.** `new Date()` de JavaScript acepta
  formatos adicionales. Aquí un formato inesperado es señal de que el contrato
  cambió, y se prefiere contarlo como descarte visible en `/health` antes que
  adivinar la fecha.
- **El servidor de `/health` falla al arrancar si el puerto está ocupado.** El
  TypeScript lo descubre en un callback que nadie mira y deja al worker
  corriendo con un `/health` inaccesible.

### Lo que sigue sin resolver en las dos implementaciones

Ninguna detecta un **stream mudo que mantiene el TCP abierto**: si el proveedor
deja de emitir sin cerrar la conexión, ambas esperan indefinidamente. El
`AIS_STALL_TIMEOUT_SECONDS` del `.env.example` es del proveedor TCP antiguo de
Kystverket, no de este camino.

## Verificación hecha

Escribiendo el mismo fixture con los dos caminos en bases recién migradas e
idénticas, y comparando todas las columnas de las tres tablas, **las filas
salieron sin una sola diferencia**. A eso se suman 40 pruebas, seis de ellas de
integración contra PostGIS, y una ejecución del binario de principio a fin
contra un proveedor simulado: snapshot, stream, `/health` en 200 y cierre
ordenado con `SIGTERM`.

## Cómo se cerró

El criterio de salida que fijaba este ADR era un día de tráfico real de
BarentsWatch con las dos implementaciones corriendo en paralelo, comparando
filas por minuto, conjunto de MMSI y tasas de descarte.

**Ese criterio no se ejecutó.** `apps/ingestor` se retiró antes, por el tamaño
de la imagen y el consumo de memoria, que eran los dos motivos del port y ya
estaban demostrados:

| | TypeScript | Go |
|---|---|---|
| RSS | ~120 MB | 13,3 MB |
| Imagen | ~400 MB | 10,5 MB |

Lo que queda sin comprobar es el comportamiento frente a **formas de mensaje
que el fixture no cubre**. La paridad está establecida sobre dos mensajes de
ejemplo y sobre las reglas de validación, no sobre un día de stream abierto.
Si aparece un mensaje que el normalizador en Go descarta y el de TypeScript
aceptaba, se verá como un salto en `invalidMessages` de `/health` y no como un
error.

El código retirado sigue en el historial de git, así que la comparación se
puede rehacer recuperando `apps/ingestor` de un commit anterior.

## Limpieza posterior

Retirado el worker de TypeScript, se quitaron también `persistVesselUpdate` y
`applyHistoryRetention` de `packages/db` (685 a 539 líneas) y el modelo de
escritura `VesselUpdate` / `AIS_PROVIDER` de `packages/domain` (188 a 171). El
reparto queda limpio: **el camino de escritura vive en Go y el de lectura en
TypeScript**, y ya no hay forma de confundirlos.

Con ellos se fue también el esquema Drizzle. Tras la poda no lo importaba
ningún código: su único consumidor era `drizzle-kit generate`, que escribía en
`migrations/drizzle`, **un directorio que nunca llegó a existir**. Las
migraciones de este proyecto siempre han sido SQL escrito a mano en
`migrations/*.sql`, aplicado por `packages/db/src/migrate.ts`.

Se retiraron juntos `src/schema.ts`, `drizzle.config.ts`, el export `./schema`,
el script `db:generate` y la dependencia `drizzle-kit` (11 paquetes menos,
`node_modules` de 92 a 62 MB). **`drizzle-orm` se queda**: es lo que ejecuta
las consultas de lectura de la web.

Lo que se pierde es la descripción tipada de las tablas, que no la consumía
nadie, y la posibilidad de generar migraciones desde el esquema, que no se
usaba. Lo que queda como única fuente de verdad del esquema son las migraciones
SQL, que ya lo eran de hecho.

No se podó el esquema por columnas antes de retirarlo, y conviene decir por
qué: todas las que declaraba existen en la base, incluidas las que ya nadie
escribe (`ais_decode_failures` entera, `message_hash`, `ais_second`,
`radio_channel`, las cuatro `dimension_to_*`, `eta_raw`). Quitarlas habría
introducido deriva entre esquema y base en lugar de eliminar código muerto. La
elección real era conservarlo entero o retirarlo entero.
