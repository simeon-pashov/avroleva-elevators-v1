import { useEffect } from 'react'
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
import { NotificationSettingsPage } from './pages/settings/NotificationSettingsPage'
import { DataSettingsPage } from './pages/settings/DataSettingsPage'
import { BillingSettingsPage } from './pages/settings/BillingSettingsPage'
import { PlanningSettingsPage } from './pages/settings/PlanningSettingsPage'
import { DayPlanPage } from './pages/plan/DayPlanPage'
import { InvoicesListPage } from './pages/invoices/InvoicesListPage'
import { InvoiceDetailPage } from './pages/invoices/InvoiceDetailPage'
import { BankImportPage } from './pages/invoices/BankImportPage'
import { BuildingStatementPage } from './pages/buildings/BuildingStatementPage'
import { NotificationsLogPage } from './pages/notifications/NotificationsLogPage'
import { ReportsPage } from './pages/reports/ReportsPage'
import { ImportPage } from './pages/ImportPage'
import { CallbacksPage } from './pages/callbacks/CallbacksPage'
import { DefectsPage } from './pages/defects/DefectsPage'
import { CalendarPage } from './pages/calendar/CalendarPage'
import { JobsPage } from './pages/jobs/JobsPage'
import { JobFormPage } from './pages/jobs/JobFormPage'
import { JobDetailPage } from './pages/jobs/JobDetailPage'
import { AdminLoginPage } from './pages/admin/AdminLoginPage'
import { AdminShell } from './pages/admin/AdminShell'
import { AdminTenantsPage } from './pages/admin/AdminTenantsPage'
import { AdminTenantDetailPage } from './pages/admin/AdminTenantDetailPage'
import { AdminNewTenantPage } from './pages/admin/AdminNewTenantPage'
import { NotFoundPage } from './pages/NotFoundPage'

function RequireAuth() {
  const { me, loading, ensure } = useAuth()
  const location = useLocation()
  useEffect(() => ensure(), [ensure])
  if (loading) return <Spinner />
  if (!me) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  return <Shell />
}

function RequireRole({ roles }: { roles: Array<'owner' | 'office' | 'technician'> }) {
  const { hasRole } = useAuth()
  return hasRole(...roles) ? <Outlet /> : <Navigate to="/" replace />
}

function RequireAdmin() {
  const { admin, loading, ensure } = useAdminAuth()
  useEffect(() => ensure(), [ensure])
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
        <Route path="/callbacks" element={<CallbacksPage />} />
        <Route path="/defects" element={<DefectsPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/jobs/:id" element={<JobDetailPage />} />
        <Route path="/plan" element={<DayPlanPage />} />
        <Route element={<RequireRole roles={['owner', 'office']} />}>
          <Route path="/import" element={<ImportPage />} />
          <Route path="/jobs/new" element={<JobFormPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/notifications" element={<NotificationsLogPage />} />
          <Route path="/settings/notifications" element={<NotificationSettingsPage />} />
          <Route path="/settings/data" element={<DataSettingsPage />} />
          <Route path="/settings/billing" element={<BillingSettingsPage />} />
          <Route path="/settings/planning" element={<PlanningSettingsPage />} />
          <Route path="/invoices" element={<InvoicesListPage />} />
          <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
          <Route path="/billing/bank-import" element={<BankImportPage />} />
          <Route path="/buildings/:id/statement" element={<BuildingStatementPage />} />
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
