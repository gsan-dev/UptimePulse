-- Rollup horario permanente de "checks" (Fase 2.2, decisión anunciada ya en
-- la migración 0002): un "continuous aggregate" de TimescaleDB, NO sujeto a
-- la política de retención de 90 días de la hypertable "checks" en crudo.
-- Sirve para calcular uptime %/tiempo de respuesta medio sobre rangos largos
-- (7d/30d/90d) sin tener que escanear millones de filas de "checks".
--
-- No se modela como tabla de Drizzle (packages/db/src/schema.ts) porque es
-- una vista materializada gestionada por Timescale, no una tabla normal: se
-- consulta con SQL crudo (ver apps/api/src/lib/metrics.ts).
CREATE MATERIALIZED VIEW checks_hourly
WITH (timescaledb.continuous) AS
SELECT
  monitor_id,
  time_bucket('1 hour', "timestamp") AS bucket,
  count(*) AS total_checks,
  count(*) FILTER (WHERE status = 'up') AS up_checks,
  count(*) FILTER (WHERE status = 'down') AS down_checks,
  avg(response_time_ms) AS avg_response_time_ms
FROM checks
GROUP BY monitor_id, bucket
WITH NO DATA;

-- "Real-time aggregation" (activada por defecto): las consultas sobre esta
-- vista combinan los buckets ya materializados con los checks crudos más
-- recientes que el refresco todavía no ha procesado, así que el uptime del
-- rango "última hora" es correcto incluso antes de que corra el primer
-- refresco automático.
SELECT add_continuous_aggregate_policy('checks_hourly',
  start_offset => INTERVAL '3 hours',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '30 minutes',
  if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS checks_hourly_monitor_bucket_idx ON checks_hourly (monitor_id, bucket DESC);
