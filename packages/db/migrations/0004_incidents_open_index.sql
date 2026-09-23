-- El motor de incidentes (Fase 2.2) hace, en cada check "down", la consulta
-- "¿hay ya un incidente abierto para este monitor?" (resolved_at IS NULL).
-- Un índice parcial solo sobre las filas abiertas es minúsculo (hay pocos
-- incidentes abiertos a la vez) y hace esa consulta, que se repite en cada
-- check fallido de cada monitor, prácticamente gratis.
CREATE INDEX IF NOT EXISTS incidents_open_by_monitor_idx
  ON incidents (monitor_id)
  WHERE resolved_at IS NULL;
