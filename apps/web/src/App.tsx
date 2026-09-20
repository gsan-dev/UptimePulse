import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AuthProvider } from "./context/AuthContext";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { MonitorDetailPage } from "./pages/MonitorDetailPage";
import { NewMonitorPage } from "./pages/NewMonitorPage";
import { RegisterPage } from "./pages/RegisterPage";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/monitors" element={<DashboardPage />} />
          <Route path="/monitors/new" element={<NewMonitorPage />} />
          <Route path="/monitors/:id" element={<MonitorDetailPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/monitors" replace />} />
      </Routes>
    </AuthProvider>
  );
}
