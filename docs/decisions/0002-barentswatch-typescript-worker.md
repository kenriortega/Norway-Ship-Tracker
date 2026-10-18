# ADR 0002: BarentsWatch y worker TypeScript

**Estado:** aceptado.

## Contexto

El endpoint TCP atribuido a Kystverket no fue accesible durante la verificación.
La vía oficial actual para AIS abierto es BarentsWatch, que entrega posiciones
normalizadas mediante un stream HTTP autenticado con OAuth2.

El frontend se desplegará en Vercel. Una función de Vercel no es el lugar
adecuado para mantener una conexión HTTP que no termina y reconecta durante toda
la vida del servicio.

## Decisión

- BarentsWatch Live AIS es el proveedor primario.
- Un worker Node.js/TypeScript persistente consume el stream y escribe PostGIS.
- Next.js se despliega en Vercel y realiza consultas cortas a PostgreSQL.
- Drizzle define el esquema compartido y encapsula el acceso a la base de datos.
- El código Rust y las herramientas NMEA se conservan temporalmente como
  referencia y posible proveedor alternativo.

## Consecuencias

- Web, dominio e ingestión comparten TypeScript.
- El worker necesita un servicio de contenedores separado de Vercel.
- Las credenciales AIS solo están disponibles en el worker.
- `DATABASE_URL` sí debe configurarse tanto en Vercel como en el worker; en
  Vercel se debe usar una URL con pooling.
