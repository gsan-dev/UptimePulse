import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { setActiveOrganizationId } from "../api/client";
import { listOrganizations, type ApiOrganizationSummary, type OrganizationRole } from "../api/organizations";
import { useAuth } from "./AuthContext";

interface OrganizationContextValue {
  organizations: ApiOrganizationSummary[];
  /** null mientras se cargan o si el usuario no tiene ninguna (no debería pasar). */
  active: ApiOrganizationSummary | null;
  role: OrganizationRole | null;
  /** true si el rol actual permite crear/editar/borrar (editor o admin). */
  canEdit: boolean;
  isAdmin: boolean;
  setActive: (organizationId: string) => void;
  refresh: () => Promise<void>;
}

const OrganizationContext = createContext<OrganizationContextValue | undefined>(undefined);

const STORAGE_KEY = "uptimepulse.activeOrganizationId";

function readStoredId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeId(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage puede no estar disponible (modo privado, iframe con
    // sandbox…): la organización activa se recuerda solo en memoria.
  }
}

/**
 * Organización activa (Fase 4.1). Se carga la lista de organizaciones del
 * usuario al iniciar sesión, se recupera la última elegida de localStorage
 * (solo como comodidad por pestaña: si ya no es miembro, se cae a la
 * personal) y se publica al cliente HTTP para que toda petición lleve
 * `X-Organization-Id`. Cambiarla recarga la página: es la forma más simple y
 * segura de garantizar que ningún componente se queda mostrando datos de
 * la organización anterior (monitores, sockets, listas).
 */
export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [organizations, setOrganizations] = useState<ApiOrganizationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const list = await listOrganizations();
    setOrganizations(list);
    setActiveId((current) => {
      const wanted = current ?? readStoredId();
      const stillMember = wanted && list.some((org) => org.id === wanted);
      // La personal es la primera (la API ordena por fecha de creación y la
      // del registro siempre es la más antigua del propio usuario).
      const next = stillMember ? wanted : (list[0]?.id ?? null);
      setActiveOrganizationId(next);
      storeId(next);
      return next;
    });
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!user) {
      setOrganizations([]);
      setActiveId(null);
      setActiveOrganizationId(null);
      setLoaded(false);
      return;
    }
    void refresh();
  }, [user, refresh]);

  function setActive(organizationId: string): void {
    if (organizationId === activeId) return;
    setActiveOrganizationId(organizationId);
    storeId(organizationId);
    window.location.assign("/monitors");
  }

  const active = useMemo(() => organizations.find((org) => org.id === activeId) ?? null, [organizations, activeId]);
  const role = active?.role ?? null;

  const value: OrganizationContextValue = {
    organizations,
    active,
    role,
    canEdit: role === "admin" || role === "editor",
    isAdmin: role === "admin",
    setActive,
    refresh,
  };

  // Hasta saber la organización activa no se renderiza nada protegido: si
  // no, la primera petición de cada página saldría sin cabecera y podría
  // pintar la organización personal para luego "saltar" a la elegida.
  if (user && !loaded) {
    return <div className="p-8 text-gray-400">Cargando…</div>;
  }

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

export function useOrganization(): OrganizationContextValue {
  const ctx = useContext(OrganizationContext);
  if (!ctx) throw new Error("useOrganization debe usarse dentro de <OrganizationProvider>");
  return ctx;
}
