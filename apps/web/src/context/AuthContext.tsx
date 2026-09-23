import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  fetchMe,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  silentRefresh,
  updateMe,
  type RegisterInput,
  type UpdateProfileInput,
} from "../api/auth";
import { useIdleSession } from "../hooks/useIdleSession";
import type { ApiUser } from "../api/types";

interface AuthContextValue {
  user: ApiUser | null;
  isLoading: boolean;
  /**
   * true cuando la última sesión se cerró sola por inactividad (no porque
   * el usuario pulsara "Cerrar sesión"). Lo usa la pantalla de login para
   * explicar por qué está pidiendo la contraseña otra vez.
   */
  sessionExpired: boolean;
  /** `identifier` puede ser el email o el nombre de usuario. */
  login: (identifier: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  updateProfile: (input: UpdateProfileInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  // Al montar la app (ej. recargar la página), el access token en memoria se
  // perdió — se intenta recuperar la sesión con la cookie httpOnly de refresh.
  // Si esa cookie ya no vale (el navegador se cerró, o pasaron los minutos de
  // inactividad), simplemente no hay sesión: eso es justo lo que se busca.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await silentRefresh();
      if (!token) {
        if (!cancelled) setIsLoading(false);
        return;
      }
      try {
        const me = await fetchMe();
        if (!cancelled) setUser(me);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Cierre por inactividad: se borra la cookie en el servidor (por si el
  // navegador la conservara) y se vacía el usuario, lo que hace que
  // <ProtectedRoute> lleve a /login.
  const handleIdleExpire = useCallback(() => {
    setSessionExpired(true);
    setUser(null);
    void apiLogout().catch(() => {
      // La sesión ya estaba muerta en el servidor: que el logout falle es
      // el caso normal, no un error que enseñar.
    });
  }, []);

  useIdleSession(user !== null, handleIdleExpire);

  async function login(identifier: string, password: string): Promise<void> {
    setSessionExpired(false);
    setUser(await apiLogin(identifier, password));
  }

  async function register(input: RegisterInput): Promise<void> {
    setSessionExpired(false);
    setUser(await apiRegister(input));
  }

  async function updateProfile(input: UpdateProfileInput): Promise<void> {
    setUser(await updateMe(input));
  }

  async function logout(): Promise<void> {
    setSessionExpired(false);
    await apiLogout();
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{ user, isLoading, sessionExpired, login, register, updateProfile, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
