import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { AuthProvider, useAuth } from '@/lib/auth'
import { RequireApiKey, RequireAuth } from '@/components/protected'
import { PortalShell, type NavItem } from '@/components/layout/shell'
import { Toaster } from '@/components/ui/sonner'
import { LayoutDashboard, MessageSquare, Send, Settings, Wallet, ArrowLeftRight, KeyRound } from 'lucide-react'
import LoginPage from './pages/login'
import ConnectPage from './pages/connect'
import DashboardPage from './pages/dashboard'
import WalletsPage from './pages/wallets'
import CollectionsPage from './pages/collections'
import DisbursementsPage from './pages/disbursements'
import SmsPage from './pages/sms'
import SettingsPage from './pages/settings'
import NotFoundPage from '@/pages/not-found'
import PayoutLinkView from './pages/payout-link-view'

const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/wallets', label: 'Wallets', icon: Wallet },
  { to: '/collections', label: 'Collections', icon: ArrowLeftRight },
  { to: '/disbursements', label: 'Disbursements', icon: Send },
  { to: '/sms', label: 'SMS', icon: MessageSquare },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function ShellFrame() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  // If the API key gets rejected mid-session, force re-connect.
  useEffect(() => {
    const onRejected = () => navigate('/connect', { replace: true })
    window.addEventListener('zoo:key-rejected', onRejected)
    return () => window.removeEventListener('zoo:key-rejected', onRejected)
  }, [navigate])

  if (!user) return null
  return (
    <PortalShell
      brand="Zoo Studios"
      brandSub="Client Portal"
      nav={NAV}
      user={user}
      onLogout={() => {
        logout()
        navigate('/login', { replace: true })
      }}
    >
      <Outlet />
    </PortalShell>
  )
}

export default function App() {
  return (
    <AuthProvider allowedRoles={['USER']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/payout/:token" element={<PayoutLinkView />} />
        <Route element={<RequireAuth />}>
          <Route element={<ShellFrame />}>
            <Route path="/connect" element={<ConnectPage />} />
            <Route element={<RequireApiKey />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/wallets" element={<WalletsPage />} />
              <Route path="/collections" element={<CollectionsPage />} />
              <Route path="/disbursements" element={<DisbursementsPage />} />
              <Route path="/sms" element={<SmsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <Toaster position="top-right" richColors closeButton />
    </AuthProvider>
  )
}
