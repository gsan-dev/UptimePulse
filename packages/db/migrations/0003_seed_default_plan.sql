-- Plan por defecto ("free") que se asigna a toda organización nueva desde
-- el registro (Fase 1.2). Límites razonables para un portfolio, no una
-- estrategia de monetización real: 5 monitores, intervalo mínimo 5 minutos.
INSERT INTO plans (name, max_monitors, min_interval_seconds, allowed_channels)
VALUES ('free', 5, 300, '["email"]'::jsonb)
ON CONFLICT (name) DO NOTHING;
