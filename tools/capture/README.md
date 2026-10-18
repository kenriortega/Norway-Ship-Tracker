# AIS capture

Cliente de captura para el stream TCP abierto de Kystverket.

```sh
cargo run -p ais-capture
```

Características:

- Timeout de conexión y detección de stream estancado.
- Reconexión con backoff exponencial y jitter.
- Canal limitado para backpressure.
- Framing compartido con `ais-replay`.
- Validación NMEA antes de escribir.
- Rotación por tamaño y retención por cantidad de archivos.
- Apagado mediante `Ctrl+C` o `CAPTURE_RUN_SECONDS`.

La herramienta solo elimina archivos denominados `ais-*.nmea` dentro del
directorio configurado. Otros archivos se conservan.
