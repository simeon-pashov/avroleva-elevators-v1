import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router'
import { useAuth } from './auth/AuthProvider'
import { useAdminAuth } from './auth/AdminAuthProvider'
import { Shell } from './components/Shell'
import { Spinner } from './components/ui'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { BuildingsListPage } from './pages/buildings/BuildingsListPage'
import { BuildingDetailPage } from './pages/buildings/BuildingDetailPage'
import { BuildingFormPage } from './pages/buildings/BuildingFormPage'
import { ElevatorsListPage } from './pages/elevators/ElevatorsListPage'
import { ElevatorDetailPage } from './pages/elevators/ElevatorDetailPage'
import { ElevatorFormPage } from './pages/elevators/ElevatorFormPage'
import { CustomersListPage } from './pages/customers/CustomersListPage'
import { CustomerDetailPage } from './pages/customers/CustomerDetailPage'
import { CustomerFormPage } from './pages/customers/CustomerFormPage'
import { ContractsListPage } from './pages/contracts/ContractsListPage'
import { ContractDetailPage } from './pages/contracts/ContractDetailPage'
import { ContractFormPage } from './pages/contracts/ContractFormPage'
import { UsersPage } from './pages/UsersPage'
import { SettingsPage } from './pages/SettingsPage'
import { ImportPage } from './pages/ImportPage'
import { AdminLoginPage } from './pages/admin/AdminLoginPage'
import { AdminShell } from './pages/admin/AdminShell'
import { AdminTenantsPage } from './pages/admin/AdminTenantsPage'
import { AdminTenantDetailPage } from './pages/admin/AdminTenantDetailPage'
import { AdminNewTenantPage } from './pages/admin/AdminNewTenantPage'
import { NotFoundPage } from './pages/NotFoundPage'

function RequireAuth() {
  const { me, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Spinner />
  if (!me) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  return <Shell />
}

function RequireRole({ roles }: { roles: Array<'owner' | 'office' | 'technician'> }) {
  const { hasRole } = useAuth()
  return hasRole(...roles) ? <Outlet /> : <Navigate to="/" replace />
}

function RequireAdmin() {
  const { admin, loading } = useAdminAuth()
  if (loading) return <Spinner />
  if (!admin) return <Navigate to="/admin/login" replace />
  return <AdminShell />
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/admin" element={<RequireAdmin />}>
        <Route index element={<AdminTenantsPage />} />
        <Route path="tenants/new" element={<AdminNewTenantPage />} />
        <Route path="tenants/:id" element={<AdminTenantDetailPage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/buildings" element={<BuildingsListPage />} />
        <Route path="/buildings/new" element={<BuildingFormPage />} />
        <Route path="/buildings/:id" element={<BuildingDetailPage />} />
        <Route path="/buildings/:id/edit" element={<BuildingFormPage />} />
        <Route path="/elevators" element={<ElevatorsListPage />} />
        <Route path="/elevators/new" element={<ElevatorFormPage />} />
        <Route path="/elevators/:id" element={<ElevatorDetailPage />} />
        <Route path="/elevators/:id/edit" element={<ElevatorFormPage />} />
        <Route path="/customers" element={<CustomersListPage />} />
        <Route path="/customers/new" element={<CustomerFormPage />} />
        <Route path="/customers/:id" element={<CustomerDetailPage />} />
        <Route path="/customers/:id/edit" element={<CustomerFormPage />} />
        <Route path="/contracts" element={<ContractsListPage />} />
        <Route path="/contracts/new" element={<ContractFormPage />} />
        <Route path="/contracts/:id" element={<ContractDetailPage />} />
        <Route path="/contracts/:id/edit" element={<ContractFormPage />} />
        <Route element={<RequireRole roles={['owner', 'office']} />}>
          <Route path="/import" element={<ImportPage />} />
        </Route>
        <Route element={<RequireRole roles={['owner']} />}>
          <Route path="/users" element={<UsersPage />} />
        </Route>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
