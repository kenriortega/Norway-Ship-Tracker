# AIS replay

La herramienta de replay alimenta el mismo framing y parser NMEA que utilizará
el receptor TCP, a partir de un archivo local o de entrada estándar.

Objetivos:

- Desarrollo sin conexión al stream remoto.
- Reproducción a velocidad original, acelerada o sin espera.
- Pruebas reproducibles de fragmentación, errores y backpressure.
- Sin rutas alternativas para parsing o decodificación.

## Uso

```sh
cargo run -p ais-replay -- fixtures/nmea/valid-single.nmea
cargo run -p ais-replay -- --strict fixtures/nmea/mixed.nmea
cat capture.nmea | cargo run -p ais-replay -- -
```

El modo `--strict` devuelve un código distinto de cero si encuentra sentencias
inválidas, líneas demasiado largas o contenido que no sea UTF-8.

