# Imagen del ingestor en Go.
#
# El contexto de build es este directorio y no la raíz del repositorio: el
# módulo es autocontenido, así que no necesita ni los workspaces de npm ni las
# migraciones. El Dockerfile del ingestor de TypeScript sí construye desde la
# raíz, porque allí el código vive repartido entre `apps` y `packages`.

FROM golang:1.25-alpine AS build

WORKDIR /src

# Las dependencias en su propia capa: cambiar código no vuelve a descargarlas.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# CGO_ENABLED=0 da un binario estático, que es lo que permite la imagen final
# vacía. -trimpath quita las rutas de la máquina de build del binario, para que
# dos builds del mismo commit den el mismo resultado.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /ingestor ./cmd/ingestor

# La imagen final no lleva distribución: solo el binario y los certificados.
# Sin sistema de ficheros no hay gestor de paquetes que parchear ni shell desde
# la que moverse si alguien entra.
FROM scratch

# El único motivo por el que esta imagen no puede ir del todo vacía: sin los
# certificados raíz, el TLS contra BarentsWatch falla con un error de
# verificación que no dice nada obvio.
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /ingestor /ingestor

# Numérico y no un nombre: `scratch` no tiene /etc/passwd donde resolverlo.
# 65534 es `nobody` por convención.
USER 65534:65534

EXPOSE 3001

ENTRYPOINT ["/ingestor"]
