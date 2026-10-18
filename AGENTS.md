# Norway Ship Tracker

Estas instrucciones amplían las reglas del workspace padre.

## Alcance del primer hito

- BarentsWatch Live AIS es la fuente primaria de datos abiertos de Kystverket.
- La ingestión debe conservar las fronteras entre autenticación, transporte
  HTTP, framing NDJSON, normalización, dominio y persistencia.
- El stream vive en un worker persistente; no dentro de funciones de Vercel.
- El frontend consume modelos normalizados; no conoce sentencias AIVDM.
- PostgreSQL/PostGIS mantiene la última posición por MMSI y el historial
  muestreado.

## Forma de trabajo

- Mantener fixtures pequeños para todo cambio en el parser o normalizador.
- Las pruebas no deben depender de una conexión activa con Kystverket.
- No registrar credenciales ni capturas AIS extensas en Git.
- Documentar decisiones que alteren límites del sistema en `docs/decisions/`.
- Mostrar siempre la atribución a Kystverket y NLOD 2.0 en las superficies que
  publiquen datos AIS.

