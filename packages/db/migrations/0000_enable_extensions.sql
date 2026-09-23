-- Extensiones de Postgres necesarias antes de crear el resto del esquema.
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid() para las PK uuid
CREATE EXTENSION IF NOT EXISTS timescaledb; -- hypertables (usada por "checks", ver 0002)
