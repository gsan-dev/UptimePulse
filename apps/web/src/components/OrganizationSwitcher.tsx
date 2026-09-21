import { Link } from "react-router-dom";
import { ROLE_LABELS } from "../api/organizations";
import { useOrganization } from "../context/OrganizationContext";

/**
 * Selector de organización activa (Fase 4.1) + etiqueta del rol que se tiene
 * en ella y enlace a la página de equipo. Si el usuario solo pertenece a una
 * organización, se muestra su nombre sin desplegable.
 */
export function OrganizationSwitcher() {
  const { organizations, active, role, setActive } = useOrganization();
  if (!active) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {organizations.length > 1 ? (
        <select
          aria-label="Organización activa"
          value={active.id}
          onChange={(e) => setActive(e.target.value)}
          className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-white outline-none focus:border-emerald-500"
        >
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-gray-300">{active.name}</span>
      )}
      {role && (
        <span
          title="Tu rol en esta organización"
          className={`rounded-full px-2 py-0.5 text-xs ${
            role === "readonly" ? "bg-amber-500/15 text-amber-300" : "bg-white/10 text-gray-300"
          }`}
        >
          {ROLE_LABELS[role]}
        </span>
      )}
      <Link to="/team" className="text-gray-400 hover:text-emerald-400">
        Equipo
      </Link>
      <Link
        to="/pricing"
        className="text-gray-400 hover:text-emerald-400"
        title="Ver planes y límites"
      >
        Plan: {active.planName ?? "—"}
      </Link>
    </div>
  );
}
