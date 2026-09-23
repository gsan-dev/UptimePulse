-- Corrige una suposición equivocada de la migración 0005: se asumió que
-- "real-time aggregation" viene activada por defecto en un continuous
-- aggregate, pero en esta versión de TimescaleDB el valor por defecto de
-- `materialized_only` es TRUE (desactivada). Con eso, consultar
-- "checks_hourly" solo devolvía los buckets ya materializados por el job de
-- refresco (cada 30 min) e ignoraba los checks recién insertados,
-- devolviendo 0 resultados hasta el primer refresco. Descubierto verificando
-- Fase 2.2 en vivo: las métricas de un monitor con checks reales daban
-- totalChecks=0.
ALTER MATERIALIZED VIEW checks_hourly SET (timescaledb.materialized_only = false);
