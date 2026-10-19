# ADR 0003: Retención del histórico de posiciones

**Estado:** aceptado.

## Contexto

`vessel_positions` crecía sin ninguna política. Medido sobre dieciséis horas de
ingestión continua:

| | |
|---|---|
| Filas | 522.255 |
| Tamaño total | 346 MB (248 MB de datos, 98 MB de índices) |
| Pico horario | 121.833 filas/h, unos 2,9 M al día |
| Coste por fila | ~694 B, es decir **~2,0 GB al día** |

No había retención, ni particionado, ni purga. A ese ritmo la tabla degrada
primero las consultas y después el disco de la máquina.

Al medir aparecieron dos cosas que nadie había mirado:

- `vessel_positions_location_gix` acumulaba **0 escaneos**. Ninguna consulta del
  histórico filtra por geometría; todas lo hacen por `received_at` y `mmsi`. Eran
  37 MB de índice GiST que además encarecía cada una de las ~34 inserciones por
  segundo.
- `vessel_positions.raw_payload` se escribía en cada fila y **no se lee nunca**:
  342 B de media, casi la mitad del tamaño. El único `raw_payload` que se
  consulta es el de `vessel_latest_positions`.

Las ventanas que piden de verdad los consumidores del histórico son:

| Endpoint | Ventana |
|---|---|
| `/api/stats` (actividad) | 1 h fija |
| `/api/dark` (salud de flota) | 6 h fija |
| `/api/ports` (`arrived`) | `windowHours`, por defecto 24 |
| `/api/encounters` (`under_way`) | `windowHours`, por defecto 24 |

`/api/vessels/[mmsi]/track` **no** entra aquí: es un proxy al histórico de 24 h
de BarentsWatch y no toca nuestra base.

Ambos endpoints con ventana admitían hasta 168 h (7 días), un tope que ninguna
vista de la web ejercita: las dos se llaman con el valor por defecto.

## Decisión

1. **`vessel_positions` pasa a ser una tabla particionada por rango diario sobre
   `received_at`.** Retirar un día caducado es un `DROP TABLE` instantáneo.
2. **Se conservan el día en curso más tres días completos**, lo que garantiza al
   menos 72 h de histórico sea cual sea la hora.
3. **El tope de `windowHours` baja de 168 a 72 h** en `/api/ports` y
   `/api/encounters`.
4. **La purga la ejecuta el worker**, al arrancar y cada 30 minutos, llamando a
   la función SQL `maintain_vessel_positions_partitions(retention_days,
   ahead_days)` que crea la migración 0003.
5. **Se elimina la columna `raw_payload` de `vessel_positions`**, junto con los
   índices `vessel_positions_location_gix` y
   `vessel_positions_mmsi_received_at_idx`.
6. **No se guarda un agregado del histórico antiguo.** Se descarta por ahora.

Configurable mediante `AIS_HISTORY_RETENTION_DAYS` (3),
`AIS_PARTITION_AHEAD_DAYS` (2) y `AIS_MAINTENANCE_INTERVAL_MINUTES` (30).

## Alternativas consideradas

### Purga con `DELETE` periódico en vez de particionar

Descartada. Borrar 2,9 M de filas al día deja otras tantas tuplas muertas que el
autovacuum tiene que recorrer mientras siguen entrando treinta inserciones por
segundo, y el fichero no se encoge sin un `VACUUM FULL` que bloquea la tabla
entera. A este caudal no era una decisión ajustada.

### `pg_cron` o un cron del sistema

`pg_cron` no está disponible en la imagen `postgis/postgis:16-3.5`
(`pg_available_extensions` no lo lista), así que programarlo dentro de Postgres
obligaría a mantener una imagen propia. Un cron del sistema sería una pieza
fuera del repositorio, invisible para `compose.yaml` y no reproducible.

El worker ya es un proceso persistente con conexión a la base y configuración
propia. Es uno solo, así que no hay coordinación que resolver, y si está caído
tampoco está entrando nada que purgar. El DDL vive en SQL, versionado junto al
esquema; el worker solo decide cuándo llamarlo.

### Conservar un agregado del histórico antiguo

Las dos consultas largas no piden un agregado genérico sino un hecho por barco:
*¿se movió a más de 3 nudos en la ventana, y cuándo por última vez?* Eso cabría
en una tabla `(mmsi, hora, max_speed, last_moving_at)` de unas 240.000 filas al
día frente a 2,9 M — un 2 % del tamaño — y las consultas largas saldrían incluso
más baratas.

Pero obliga a reescribir ambas consultas como unión de crudo y rollup, y a
mantener la corrección en la frontera entre los dos. Es trabajo real para
sostener una ventana de siete días que ningún llamante ejercita. **Queda
documentado como el camino a seguir si alguien quiere histórico largo**, y el
muestreo de entrada (`AIS_HISTORY_SAMPLE_SECONDS`, una posición por barco y
minuto) sigue haciendo su parte.

### Mantener el tope de 168 h

Habría costado unos 14 GB en estado estacionario por una capacidad que hoy no
usa nadie. Dejar el tope sin la retención que lo respalde sería peor: una
petición de 168 h devolvería una respuesta incompleta sin decirlo.

## Consecuencias

### Tamaño

| Escenario | Por fila | Cuatro días |
|---|---|---|
| Antes | 694 B | ~8,0 GB |
| Sin los dos índices | ~550 B | ~6,4 GB |
| Sin `raw_payload` además | ~280 B | **~3,2 GB** |

Y, sobre todo, deja de crecer.

### Clave primaria e índices

Postgres exige que la columna de particionado forme parte de cualquier
restricción única. La clave primaria ya era `(mmsi, received_at)`, así que
sobrevive sin cambios. Los índices se declaran en la tabla padre y Postgres los
propaga a cada partición, también a las que cree después el mantenimiento.

`vessel_positions_mmsi_received_at_idx` se elimina por redundante: comparte
prefijo con la clave primaria y sirve igual al filtro `WHERE mmsi = ? AND
received_at >= ?` del deduplicado. El sentido `DESC` no cambia nada para ese
filtro. Se conserva `vessel_positions_received_at_idx`, que es el que trabaja
(167.896 escaneos, 2,6 M tuplas leídas).

### Aplicación sobre la base con datos

Una tabla normal no se puede convertir en particionada in situ. La migración
renombra la original, crea la particionada, copia las filas y elimina la
antigua, todo dentro de la transacción que abre el runner: si algo falla, la
tabla original queda intacta y no hay ventana de pérdida. Con medio millón de
filas son segundos, pero toma un lock exclusivo, así que **conviene aplicarla
con el worker parado**.

A partir de unos 20 M de filas este enfoque dejaría de ser aceptable y habría
que pasar la tabla antigua con `ATTACH PARTITION` en lugar de copiarla.

Los `raw_payload` del histórico ya almacenados se pierden al aplicarla. Es la
única parte destructiva y fue una decisión explícita.

### Si el worker se para

Las particiones se aprovisionan con dos días de margen, no solo el siguiente, de
modo que una parada larga no deja al sistema sin dónde insertar al cambiar la
fecha. Un fallo del mantenimiento no interrumpe la ingestión: se registra en
`/health` (`lastMaintenanceError`) y se reintenta en la pasada siguiente.

### Deriva de esquema corregida de paso

`schema.ts` declaraba en `vesselPositions` una columna `radio_channel` que la
base nunca tuvo, y un `provider` por defecto `'barentswatch'` donde la base
decía `'kystverket_tcp'`. La tabla reconstruida y el modelo de Drizzle quedan
alineados: sin `radio_channel` y con `'barentswatch'` por defecto.
