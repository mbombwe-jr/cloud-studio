import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeftRight, MessageSquare, Send, Wallet as WalletIcon } from 'lucide-react'
import { api, tokens } from '@/lib/api'
import { fmtTZS, fmtDate } from '@/lib/format'
import type { AccountProfile } from '@/lib/types'
import { StatCard } from '@/components/stat-card'
import { StatusBadge } from '@/components/status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'

export default function DashboardPage() {
  const [profile, setProfile] = useState<AccountProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .getKeyed<AccountProfile>('/me')
      .then((p) => alive && setProfile(p))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-destructive">{error}</CardContent>
      </Card>
    )
  }

  const wallets = profile?.wallets ?? []
  const collection = wallets.find((w) => w.type === 'COLLECTION')
  const disbursement = wallets.find((w) => w.type === 'DISBURSEMENT')
  const granted = (profile?.permissions ?? []).filter((p) => p.granted)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {loading ? <Skeleton className="h-7 w-56" /> : `Welcome, ${profile?.accountName}`}
        </h1>
        <p className="text-sm text-muted-foreground">Account overview and balances</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Collection wallet"
          value={fmtTZS(collection?.balance)}
          hint={collection ? `${collection.currency} · ${collection.status}` : undefined}
          icon={WalletIcon}
          loading={loading}
          accent="success"
        />
        <StatCard
          title="Disbursement wallet"
          value={fmtTZS(disbursement?.balance)}
          hint={disbursement ? `${disbursement.currency} · ${disbursement.status}` : undefined}
          icon={Send}
          loading={loading}
          accent="info"
        />
        <StatCard
          title="Services granted"
          value={loading ? undefined : `${granted.length} of 3`}
          hint={granted.map((g) => g.service).join(' · ') || 'none'}
          icon={ArrowLeftRight}
          loading={loading}
        />
        <StatCard
          title="Account status"
          value={loading ? undefined : <StatusBadge status={profile?.status} />}
          hint={profile?.accountId}
          icon={MessageSquare}
          loading={loading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="animate-fade-in">
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2.5 sm:grid-cols-2">
            <Button asChild variant="outline" className="justify-start">
              <Link to="/collections">
                <ArrowLeftRight className="h-4 w-4" /> Collect via USSD push
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link to="/disbursements">
                <Send className="h-4 w-4" /> Send a payout
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link to="/sms">
                <MessageSquare className="h-4 w-4" /> Send SMS
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link to="/wallets">
                <WalletIcon className="h-4 w-4" /> View transactions
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="animate-fade-in">
          <CardHeader>
            <CardTitle>Account details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : (
              <>
                <Row label="Account name" value={profile?.accountName} />
                <Row label="Public ID" value={profile?.accountId} mono />
                <Row label="Contact email" value={profile?.contactEmail || '—'} />
                <Row label="Contact phone" value={profile?.contactPhone || '—'} />
                <Row label="Billing mode" value={profile?.billingMode || '—'} />
                <Row
                  label="Plan"
                  value={profile?.accountPlan?.plan?.name ?? 'Pay-as-you-go'}
                />
                <Separator />
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Service permissions
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(profile?.permissions ?? []).map((p) => (
                      <Badge key={p.service} variant={p.granted ? 'success' : 'muted'} className="font-mono text-[11px]">
                        {p.service}
                      </Badge>
                    ))}
                    {(profile?.permissions ?? []).length === 0 ? (
                      <span className="text-xs text-muted-foreground">No services configured</span>
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        Session secured · API key {tokens.getApiKey() ? 'connected for this tab only' : 'not connected'}
      </p>
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
