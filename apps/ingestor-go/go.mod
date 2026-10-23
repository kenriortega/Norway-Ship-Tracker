// El ingestor en Go vive aquí junto al de TypeScript, no en su lugar: mientras
// no se demuestre paridad conviene poder arrancar cualquiera de los dos contra
// la misma base y comparar. Módulo propio y no un miembro del workspace de
// Cargo de la raíz: no comparte nada con el backend Rust.
module github.com/kenriortega/Norway-Ship-Tracker/apps/ingestor-go

go 1.25.0

require github.com/jackc/pgx/v5 v5.11.0

require (
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	golang.org/x/sync v0.17.0 // indirect
	golang.org/x/text v0.29.0 // indirect
)
