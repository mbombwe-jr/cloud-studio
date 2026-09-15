import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { ShieldAlert } from 'lucide-react'
import { AuthProvider, useAuth } from '@/lib/auth'
import { RequireAuth } from '@/components/protected'
import { PortalShell, type NavItem } from '@/components/layout/shell'
import { Toaster } from '@/components/ui/sonner'
import { Badge } from '@/components/ui/badge'
import { LayoutDashboard, Building2, Users, ScrollText, Route as RouteIcon } from 'lucide-react'
import LoginPage from './pages/login'
import DashboardPage from './pages/dashboard'
import AccountsPage from './pages/accounts'
import AccountDetailPage from './pages/account-detail'
import StaffPage from './pages/staff'
import AuditPage from './pages/audit'
import TracesPage from './pages/traces'
import NotFoundPage from '@/pages/not-found'

const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/accounts', label: 'Accounts', icon: Building2 },
  { to: '/staff', label: 'Staff', icon: Users },
  { to: '/audit', label: 'Audit logs', icon: ScrollText },
  { to: '/traces', label: 'Traces', icon: RouteIcon },
]

function ShellFrame() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  if (!user) return null
  return (
    <PortalShell
      brand="Zoo Studios"
      brandSub="Admin Portal"
      nav={NAV}
      user={user}
      onLogout={() => {
        logout()
        navigate('/login', { replace: true })
      }}
      banner={
        user.role === 'SERVICEMAN' ? (
          <div className="flex items-center justify-center gap-2 bg-sky-50 px-4 py-1.5 text-xs text-sky-800">
            <ShieldAlert className="h-3.5 w-3.5" />
            Serviceman access is strictly read-only. Write actions are disabled.
          </div>
        ) : null
      }
    >
      <Outlet />
    </PortalShell>
  )
}

export default function App() {
  return (
    <AuthProvider allowedRoles={['ADMIN', 'SERVICEMAN']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<ShellFrame />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/accounts/:accountId" element={<AccountDetailPage />} />
            <Route path="/staff" element={<StaffPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/traces" element={<TracesPage />} />
          </Route>
        </Route>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <Toaster position="top-right" richColors closeButton />
    </AuthProvider>
  )
}

export function ReadOnlyBadge() {
  const { user } = useAuth()
  if (user?.role !== 'SERVICEMAN') return null
  return <Badge variant="info" className="text-[10px]">read-only</Badge>
}
