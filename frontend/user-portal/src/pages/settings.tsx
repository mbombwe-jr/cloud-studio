import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, Landmark, LogOut, Percent, ShieldCheck, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import { api, tokens } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { maskKey, fmtDate } from '@/lib/format'
import type { AccountProfile, SettlementAccount } from '@/lib/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { StatusBadge } from '@/components/status-badge'

export default function SettingsPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<AccountProfile | null>(null)
  const key = tokens.getApiKey()
  const settlements = (profile?.settlementAccounts ?? []) as unknown as SettlementAccount[]
  const fees = profile?.feeConfig as
    | { collectionBelowBps: number; collectionThreshold: string; collectionAboveBps: number; disbursementBelowBps: number; disbursementThreshold: string; disbursementAboveBps: number; transferBps: number }
    | undefined

  useEffect(() => {
    let alive = true
    api
      .getKeyed<AccountProfile>('/me')
      .then((p) => alive && setProfile(p))
      .catch(() => alive && setProfile(null))
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Session, connection and account information</p>
      </div>

      <Card className="animate-fade-in">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" /> Session security
          </CardTitle>
          <CardDescription>How your credentials are protected in this portal.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Signed in as" value={user?.email ?? '—'} />
          <Row label="Role" value={user?.role ?? '—'} />
          <Row label="Token storage" value="Memory + sessionStorage (tab-scoped, never persisted)" />
          <Row label="Transport" value="Private WireGuard network · Bearer JWT · X-API-Key" />
          <Separator />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                logout()
                navigate('/login', { replace: true })
              }}
            >
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                tokens.clearAll()
                navigate('/login', { replace: true })
              }}
            >
              End session & disconnect
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="animate-fade-in">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Connected account
          </CardTitle>
          <CardDescription>Business API key currently linked to this session.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="API key" value={<span className="font-mono text-xs">{key ? maskKey(key) : 'not connected'}</span>} />
          <Row label="Account" value={profile?.accountName ?? '—'} />
          <Row label="Public ID" value={profile?.accountId ?? '—'} mono />
          <Row label="Status" value={<StatusBadge status={profile?.status} />} />
          {profile?.createdAt ? <Row label="Created" value={fmtDate(profile.createdAt)} /> : null}
          <Separator />
          <Button
            variant="outline"
            onClick={() => {
              tokens.clearApiKey()
              toast.success('Account disconnected')
              navigate('/connect', { replace: true })
            }}
          >
            <Unplug className="h-4 w-4" /> Disconnect key
          </Button>
        </CardContent>
      </Card>

      <Card className="animate-fade-in">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="h-4 w-4" /> Settlement accounts
          </CardTitle>
          <CardDescription>Where collected funds are settled — auto-swept daily at 00:00 EAT or withdrawn manually.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {settlements.length === 0 ? (
            <p className="text-muted-foreground">No settlement account configured yet — ask your administrator.</p>
          ) : (
            settlements.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-4 rounded-md border p-3">
                <div>
                  <p className="font-medium">
                    {s.type === 'BANK'
                      ? `${s.bankName}${s.bankInitials ? ` (${s.bankInitials})` : ''} · ${s.accountNumber}`
                      : `${s.method} · ${s.phoneNumber}`}
                  </p>
                  {s.accountName ? <p className="text-xs text-muted-foreground">{s.accountName}</p> : null}
                </div>
                <span className="text-xs text-muted-foreground">{s.isDefault ? 'default' : ''}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="animate-fade-in">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Percent className="h-4 w-4" /> Fee schedule
          </CardTitle>
          <CardDescription>Custom fees applied to your transactions (basis points).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {fees ? (
            <>
              <Row
                label="Collection fee"
                value={`${fees.collectionBelowBps / 100}% below ${Number(fees.collectionThreshold).toLocaleString()} TZS · ${fees.collectionAboveBps / 100}% at/above`}
              />
              <Row
                label="Disbursement fee"
                value={`${fees.disbursementBelowBps / 100}% below ${Number(fees.disbursementThreshold).toLocaleString()} TZS · ${fees.disbursementAboveBps / 100}% at/above`}
              />
              <Row label="Wallet transfer fee" value={`${fees.transferBps / 100}%`} />
            </>
          ) : (
            <Row label="Fees" value="5% below 3,000 TZS · 2% at/above · transfers 2%" />
          )}
        </CardContent>
      </Card>

      <Alert variant="info">
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Need a new API key?</AlertTitle>
        <AlertDescription>
          Keys are issued by platform administrators from the Admin Portal. Ask your admin to issue or rotate a key
          for this account, then connect it here.
        </AlertDescription>
      </Alert>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`truncate text-right ${mono ? 'font-mono text-xs' : ''}`}>{value ?? '—'}</span>
    </div>
  )
}
