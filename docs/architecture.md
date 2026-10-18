# Arquitectura del primer hito

## Flujo

```text
BarentsWatch Live AIS
        |
        v
OAuth token -> HTTP stream -> NDJSON framing -> normalizer
                                              |
                                              v
                                      domain VesselUpdate
                                              |
                                              v
                                    PostgreSQL / PostGIS
                                              |
                                              v
                                   Next.js route handlers
                                              |
                                              v
                                     Next.js + MapLibre
```

## Límites de ejecución

### Vercel

`apps/web` contiene la interfaz y endpoints HTTP cortos. No abre el stream AIS.
Cada consulta limita los resultados al viewport y usa una conexión PostgreSQL
compatible con entornos serverless.

### Worker persistente

`apps/ingestor` obtiene y renueva el token OAuth, descarga opcionalmente el
snapshot inicial, mantiene el stream, reconecta con backoff y persiste mensajes.
Expone `GET /health` en un puerto separado.

### Paquetes compartidos

- `packages/domain`: modelos independientes del transporte.
- `packages/db`: esquema Drizzle, escritura PostGIS y consultas geográficas.

## Persistencia

`vessel_latest_positions` conserva un registro por MMSI. Las actualizaciones más
antiguas no reemplazan estados más recientes. `vessel_positions` recibe como
máximo una muestra por MMSI durante cada intervalo configurado.

`received_at` representa la llegada al worker y `source_timestamp` conserva
`msgtime` de BarentsWatch.

## Tiempo real del frontend

El primer corte consulta el viewport cada pocos segundos. La animación entre dos
posiciones ocurre en el navegador. SSE o WebSocket se añadirán únicamente cuando
las métricas demuestren que el polling ya no es suficiente.

## Compatibilidad TCP

El backend Rust, las capturas NMEA y el replay permanecen en el repositorio, pero
no forman parte de la ruta de producción predeterminada.
