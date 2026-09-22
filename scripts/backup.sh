#!/usr/bin/env sh
# Copia de seguridad de la base de datos del self-hosted (Postgres/TimescaleDB).
# Uso: scripts/backup.sh [directorio_destino]   (por defecto ./backups)
# Restaurar: scripts/restore.sh backups/uptimepulse-2026-09-22T10-00-00.sql.gz
# Respeta COMPOSE_PROJECT_NAME si el stack se levantó con -p.
set -eu
cd "$(dirname "$0")/.."
DEST="${1:-backups}"
mkdir -p "$DEST"
FILE="$DEST/uptimepulse-$(date +%Y-%m-%dT%H-%M-%S).sql.gz"
# Volcado plano SIN --clean: TimescaleDB no admite restaurar "encima" de una
# base viva (el dump haría DROP EXTENSION); restore.sh recrea la base.
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-uptimepulse}" "${POSTGRES_DB:-uptimepulse}" 2>/dev/null | gzip > "$FILE"
echo "copia guardada en $FILE ($(du -h "$FILE" | cut -f1))"
