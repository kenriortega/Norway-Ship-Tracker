# ADR 0001: Kystverket TCP como fuente primaria

**Estado:** reemplazado por ADR 0002.

- Estado: aceptada
- Fecha: 2026-10-18

## Contexto

El producto debe controlar el procesamiento de los datos desde la fuente hasta
el mapa y trabajar directamente con AIS nativo.

## Decisión

Usar el stream TCP abierto de Kystverket en `153.44.253.27:5631` como proveedor
primario. El backend Rust implementará recepción, framing NMEA, ensamblado de
fragmentos y decodificación AIVDM antes de normalizar los datos.

BarentsWatch no forma parte del camino crítico. Podrá añadirse posteriormente
como adaptador alternativo o como referencia para verificar resultados.

## Consecuencias

- Controlamos validación, muestreo, almacenamiento y tipos AIS soportados.
- El decoder y la reconexión TCP son componentes críticos.
- Necesitamos fixtures y replay para desarrollar sin depender de la red.
- La aplicación debe atribuir a Kystverket y enlazar NLOD 2.0.

