import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AuthProvider } from "./context/AuthContext";
import { ConfirmProvider } from "./context/ConfirmContext";
import { OrganizationProvider } from "./context/OrganizationContext";
import { RealtimeProvider } from "./context/RealtimeContext";
import { ToastProvider } from "./context/ToastContext";
import { DashboardPage } from "./pages/DashboardPage";
import { InvitationPage } from "./pages/InvitationPage";
import { LoginPage } from "./pages/LoginPage";
import { MonitorDetailPage } from "./pages/MonitorDetailPage";
import { NewMonitorPage } from "./pages/NewMonitorPage";
import { NotificationChannelsPage } from "./pages/NotificationChannelsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { PublicStatusPage } from "./pages/PublicStatusPage";
import { RegisterPage } from "./pages/RegisterPage";
import { StatusPagesPage } from "./pages/StatusPagesPage";
import { ApiKeysPage } from "./pages/ApiKeysPage";
import { TeamPage } from "./pages/TeamPage";

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <ConfirmProvider>
          <OrganizationProvider>
            <RealtimeProvider>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                {/* Pública a propósito (Fase 3.3): sin <ProtectedRoute>, no requiere sesión. */}
                <Route path="/status/:username/:slug" element={<PublicStatusPage />} />
                {/* Pública (Fase 4.3): la página de precios se ve sin cuenta. */}
                {/* Pública (Fase 4.1): el invitado puede no tener cuenta todavía. */}
                <Route path="/invitations/:token" element={<InvitationPage />} />
                <Route element={<ProtectedRoute />}>
                  <Route path="/monitors" element={<DashboardPage />} />
                  <Route path="/monitors/new" element={<NewMonitorPage />} />
                  <Route path="/monitors/:id" element={<MonitorDetailPage />} />
                  <Route path="/channels" element={<NotificationChannelsPage />} />
                  <Route path="/status-pages" element={<StatusPagesPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/team" element={<TeamPage />} />
                  <Route path="/api-keys" element={<ApiKeysPage />} />
                </Route>
                <Route path="*" element={<Navigate to="/monitors" replace />} />
              </Routes>
            </RealtimeProvider>
          </OrganizationProvider>
        </ConfirmProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
