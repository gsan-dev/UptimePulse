import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchMe, login as apiLogin, logout as apiLogout, register as apiRegister, silentRefresh } from "../api/auth";
import type { ApiUser } from "../api/types";

interface AuthContextValue {
  user: ApiUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Al montar la app (ej. recargar la página), el access token en memoria se
  // perdió — se intenta recuperar la sesión con la cookie httpOnly de refresh.
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

  async function login(email: string, password: string): Promise<void> {
    setUser(await apiLogin(email, password));
  }

  async function register(email: string, password: string): Promise<void> {
    setUser(await apiRegister(email, password));
  }

  async function logout(): Promise<void> {
    await apiLogout();
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
