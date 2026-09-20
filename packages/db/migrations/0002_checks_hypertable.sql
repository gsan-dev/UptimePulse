-- Convierte "checks" en hypertable de TimescaleDB, particionada por "timestamp".
-- Debe ejecutarse después de crear la tabla (migración 0001).
SELECT create_hypertable('checks', by_range('timestamp'), if_not_exists => TRUE);

-- Política de retención de datos en crudo (decisión documentada en TASK.md §0.3):
-- los checks individuales se conservan 90 días; a partir de la Fase 2.2 se
-- añadirán "continuous aggregates" (rollups horarios/diarios) que sí se
-- conservan de forma indefinida y no se ven afectados por esta política.
SELECT add_retention_policy('checks', INTERVAL '90 days', if_not_exists => TRUE);

-- Índice de apoyo para las consultas más habituales: "últimos checks de un monitor".
CREATE INDEX IF NOT EXISTS checks_monitor_id_timestamp_idx ON checks (monitor_id, "timestamp" DESC);
