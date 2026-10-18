# Fixtures NMEA

Este directorio contendrá muestras pequeñas y revisadas del stream AIVDM.

Reglas:

- Un caso por archivo.
- Documentar el resultado esperado.
- Incluir checksums válidos e inválidos.
- Cubrir mensajes de uno y varios fragmentos.
- No incorporar capturas extensas ni datos ajenos al alcance de las pruebas.

Fixtures iniciales:

- `valid-single.nmea`: una sentencia válida de un fragmento.
- `valid-multipart.nmea`: un mensaje válido dividido en dos fragmentos.
- `mixed.nmea`: una sentencia válida y otra con checksum incorrecto.

