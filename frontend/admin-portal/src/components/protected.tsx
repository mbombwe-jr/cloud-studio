import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { ShieldAlert, Loader2 } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { tokens } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import type { SessionUser } from '@/lib/auth'

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50">
      <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
    </div>
  )
}

/** Blocks everything until the JWT session is verified AND the role is allowed. */
export function RequireAuth() {
  const { status, user } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <FullPageSpinner />
  if (status === 'anon' || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}

/** User-portal only: business routes additionally require a connected API key. */
export function RequireApiKey() {
  const key = tokens.getApiKey()
  if (!key) return <Navigate to="/connect" replace />
  return <Outlet />
}

export function Forbidden({ message }: { message?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6">
      <Card className="max-w-md">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <ShieldAlert className="h-10 w-10 text-destructive" />
          <h1 className="text-lg font-semibold">403 — Access denied</h1>
          <p className="text-sm text-muted-foreground">
            {message ?? 'Your account does not have permission to view this area.'}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export type { SessionUser }
