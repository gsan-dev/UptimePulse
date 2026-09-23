#!/usr/bin/env sh
# Restaura una copia hecha con scripts/backup.sh siguiendo el procedimiento
# de TimescaleDB: para API y worker, RECREA la base de datos (se pierde lo
# que hubiera), timescaledb_pre_restore → dump → timescaledb_post_restore,
# y vuelve a arrancar API y worker. Redis (colas) no se toca.
# Uso: scripts/restore.sh backups/uptimepulse-....sql.gz
set -eu
cd "$(dirname "$0")/.."
FILE="${1:?Indica el archivo .sql.gz a restaurar}"
COMPOSE="docker compose -f docker-compose.prod.yml"
USER_="${POSTGRES_USER:-uptimepulse}"
DB="${POSTGRES_DB:-uptimepulse}"
PSQL="$COMPOSE exec -T postgres psql -U $USER_ -v ON_ERROR_STOP=1 -q"

$COMPOSE stop api worker
$PSQL -d postgres -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE);"
$PSQL -d postgres -c "CREATE DATABASE \"$DB\" OWNER \"$USER_\";"
$PSQL -d "$DB" -c "CREATE EXTENSION IF NOT EXISTS timescaledb; SELECT timescaledb_pre_restore();"
gunzip -c "$FILE" | $COMPOSE exec -T postgres psql -U "$USER_" -d "$DB" -q -o /dev/null
$PSQL -d "$DB" -c "SELECT timescaledb_post_restore();"
$COMPOSE start api worker
echo "restaurado $FILE en la base $DB"
