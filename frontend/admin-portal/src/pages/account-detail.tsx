import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Copy, KeyRound, Loader2, PauseCircle, PlayCircle, Plus, Snowflake, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { fmtTZS, fmtDate, fmtDateTime } from '@/lib/format'
import type { ApiKeyRow, Collection, Payout, ServicePermission, SmsMessage, Wallet, WalletTx } from '@/lib/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { StatusBadge } from '@/components/status-badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const SERVICES = ['SMS', 'COLLECTION', 'DISBURSEMENT'] as const
const CHANNELS = ['MOBILE_MONEY', 'BANK'] as const

interface AccountFull {
  id: string
  accountId: string
  accountName: string
  status: string
  billingMode?: string
  contactEmail?: string | null
  contactPhone?: string | null
  createdAt: string
  autoSweep?: boolean
  permissions: ServicePermission[]
  wallets?: Wallet[]
  apiKeys?: ApiKeyRow[]
}

interface OverviewPayload {
  account: AccountFull
  collections: Collection[]
  payouts: Payout[]
  sms: SmsMessage[]
  audits: { id: string; action: string; createdAt: string }[]
}

interface Computations {
  range: { from: string; to: string }
  collection: { totalAmount: string; totalCount: number }
  disbursement: { totalAmount: string; totalCount: number }
  sms: { totalCount: number }
  batches?: {
    count: number
    totals: { items: number; success: number; failed: number; amount: number }
  } | null
  wallets: {
    walletType: string
    currency: string
    status: string
    openingBalance: string
    totalCredited: string
    totalDebited: string
    closingBalance: string
    liveBalance: string
    ledgerConsistent: boolean
    discrepancy: string
    movements: number
  }[]
}

export default function AccountDetailPage() {
  const { accountId = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'

  const [overview, setOverview] = useState<OverviewPayload | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getAuthed<OverviewPayload>(`/admin/accounts/${accountId}/overview`, { limit: 8 })
      setOverview(res)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        toast.error('Account not found')
        navigate('/accounts', { replace: true })
      } else {
        toast.error(e instanceof Error ? e.message : 'Failed to load account')
      }
    } finally {
      setLoading(false)
    }
  }, [accountId, navigate])

  useEffect(() => {
    void load()
  }, [load])

  const account = overview?.account

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" className="-ml-2 mb-1" onClick={() => navigate('/accounts')}>
            <ArrowLeft className="h-4 w-4" /> All accounts
          </Button>
          {loading || !account ? (
            <Skeleton className="h-8 w-56" />
          ) : (
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight">{account.accountName}</h1>
              <StatusBadge status={account.status} />
              <button
                className="inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-muted"
                onClick={() => {
                  void navigator.clipboard?.writeText(account.accountId).then(() => toast('Account ID copied'))
                }}
              >
                {account.accountId} <Copy className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
        {isAdmin && account ? (
          <div className="flex gap-2">
            {account.status === 'SUSPENDED' ? (
              <ActivateButton accountId={accountId} onDone={() => void load()} />
            ) : (
              <SuspendButton accountId={accountId} onDone={() => void load()} />
            )}
          </div>
        ) : null}
      </div>

      {loading || !account ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
      ) : (
        <Tabs defaultValue="overview">
          <TabsList className="flex-wrap">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="wallets">Wallets</TabsTrigger>
            <TabsTrigger value="computations">Computations</TabsTrigger>
            <TabsTrigger value="keys">API keys</TabsTrigger>
            <TabsTrigger value="permissions">Permissions</TabsTrigger>
            <TabsTrigger value="settlement">Settlement &amp; fees</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab data={overview!} />
          </TabsContent>
          <TabsContent value="wallets">
            <WalletsTab accountId={accountId} isAdmin={isAdmin} onChanged={() => void load()} />
          </TabsContent>
          <TabsContent value="computations">
            <ComputationsTab accountId={accountId} />
          </TabsContent>
          <TabsContent value="keys">
            <KeysTab accountId={accountId} isAdmin={isAdmin} onChanged={() => void load()} keys={account.apiKeys ?? []} />
          </TabsContent>
          <TabsContent value="permissions">
            <PermissionsTab accountId={accountId} isAdmin={isAdmin} permissions={account.permissions} onChanged={() => void load()} />
          </TabsContent>
          <TabsContent value="settlement">
            <SettlementFeesTab accountId={accountId} isAdmin={isAdmin} autoSweep={account.autoSweep} onChanged={() => void load()} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

/* ------------------------------ Overview ------------------------------ */

function OverviewTab({ data }: { data: OverviewPayload }) {
  const a = data.account
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="animate-fade-in">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>{a.contactEmail ?? '—'}</p>
            <p className="text-muted-foreground">{a.contactPhone ?? '—'}</p>
            <p className="pt-1 text-xs text-muted-foreground">Created {fmtDate(a.createdAt)}</p>
            <p className="text-xs text-muted-foreground">Billing {a.billingMode ?? '—'}</p>
          </CardContent>
        </Card>
        <Card className="animate-fade-in">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Wallets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {(a.wallets ?? []).map((w) => (
              <div key={w.id} className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{w.type}</span>
                <span className="font-mono text-xs font-semibold">{fmtTZS(w.balance)}</span>
              </div>
            ))}
            {(a.wallets ?? []).length === 0 ? <p className="text-xs text-muted-foreground">No wallets</p> : null}
          </CardContent>
        </Card>
        <Card className="animate-fade-in">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Permissions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {a.permissions.map((p) => (
              <Badge key={p.service} variant={p.granted ? 'success' : 'muted'} className="font-mono text-[11px]">
                {p.service}
              </Badge>
            ))}
            {a.permissions.length === 0 ? <p className="text-xs text-muted-foreground">None configured</p> : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MiniList
          title="Recent collections"
          empty="No collections yet"
          rows={data.collections.map((c) => ({
            key: c.id,
            left: c.reference,
            mid: fmtTZS(c.amount),
            right: <StatusBadge status={c.status} />,
          }))}
        />
        <MiniList
          title="Recent payouts"
          empty="No payouts yet"
          rows={data.payouts.map((p) => ({
            key: p.id,
            left: p.reference,
            mid: fmtTZS(p.amount),
            right: <StatusBadge status={p.status} />,
          }))}
        />
        <MiniList
          title="Recent SMS"
          empty="No messages yet"
          rows={data.sms.map((m) => ({
            key: m.id,
            left: m.senderName ?? 'default',
            mid: m.message.slice(0, 44),
            right: <StatusBadge status={m.status} />,
          }))}
        />
        <MiniList
          title="Recent audit activity"
          empty="No audit entries"
          rows={data.audits.map((x) => ({
            key: x.id,
            left: x.action,
            mid: '',
            right: <span className="text-xs text-muted-foreground">{fmtDateTime(x.createdAt)}</span>,
          }))}
        />
      </div>
    </div>
  )
}

function MiniList({
  title,
  rows,
  empty,
}: {
  title: string
  empty: string
  rows: { key: string; left: string; mid: string; right: React.ReactNode }[]
}) {
  return (
    <Card className="animate-fade-in">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-3 text-xs text-muted-foreground">{empty}</p>
        ) : (
          <div className="divide-y">
            {rows.map((r) => (
              <div key={r.key} className="flex items-center justify-between gap-3 py-2">
                <span className="truncate font-mono text-xs">{r.left}</span>
                <span className="truncate text-xs text-muted-foreground">{r.mid}</span>
                {r.right}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ------------------------------- Wallets ------------------------------- */

function WalletsTab({ accountId, isAdmin, onChanged }: { accountId: string; isAdmin: boolean; onChanged: () => void }) {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [loading, setLoading] = useState(true)
  const [move, setMove] = useState<{ type: Wallet['type']; kind: 'deposit' | 'withdraw' } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getAuthed<{ data: Wallet[] }>(`/admin/accounts/${accountId}/wallets`)
      setWallets(res.data ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load wallets')
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  async function setFrozen(type: string, frozen: boolean) {
    try {
      await api.postAuthed(`/admin/accounts/${accountId}/wallets/${type}/${frozen ? 'freeze' : 'activate'}`)
      toast.success(`${type} wallet ${frozen ? 'frozen' : 'activated'}`)
      void load()
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed')
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {loading
          ? [1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-lg" />)
          : wallets.map((w) => (
              <Card key={w.id} className="animate-fade-in">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">{w.type} wallet</CardTitle>
                    <StatusBadge status={w.status} />
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold tracking-tight">{fmtTZS(w.balance)}</p>
                  {isAdmin ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setMove({ type: w.type, kind: 'deposit' })}>
                        Deposit
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setMove({ type: w.type, kind: 'withdraw' })}>
                        Withdraw
                      </Button>
                      {w.status === 'ACTIVE' ? (
                        <Button size="sm" variant="destructive" onClick={() => void setFrozen(w.type, true)}>
                          <Snowflake className="h-3.5 w-3.5" /> Freeze
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => void setFrozen(w.type, false)}>
                          <PlayCircle className="h-3.5 w-3.5" /> Activate
                        </Button>
                      )}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-muted-foreground">Read-only access</p>
                  )}
                </CardContent>
              </Card>
            ))}
      </div>

      {move ? (
        <MoveDialog
          accountId={accountId}
          type={move.type}
          kind={move.kind}
          onClose={() => setMove(null)}
          onDone={() => {
            void load()
            onChanged()
          }}
        />
      ) : null}
    </div>
  )
}

function MoveDialog({
  accountId,
  type,
  kind,
  onClose,
  onDone,
}: {
  accountId: string
  type: string
  kind: 'deposit' | 'withdraw'
  onClose: () => void
  onDone: () => void
}) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!/^\d+(\.\d{1,2})?$/.test(amount.trim()) || Number(amount) <= 0) {
      toast.error('Enter a valid positive amount')
      return
    }
    if (reason.trim().length < 3) {
      toast.error('A short reason is required')
      return
    }
    setBusy(true)
    try {
      await api.postAuthed(`/admin/accounts/${accountId}/wallets/${type}/${kind}`, {
        amount: amount.trim(),
        reason: reason.trim(),
      })
      toast.success(`${kind} recorded on ${type} wallet`)
      onDone()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {kind === 'deposit' ? 'Deposit into' : 'Withdraw from'} {type} wallet
          </DialogTitle>
          <DialogDescription>Movements are audited with your admin identity.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="mv-amount">Amount (TZS)</Label>
            <Input id="mv-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} maxLength={15} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mv-reason">Reason</Label>
            <Input id="mv-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={100} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ----------------------------- Computations ----------------------------- */

function ComputationsTab({ accountId }: { accountId: string }) {
  const [preset, setPreset] = useState<'day' | 'month' | 'custom'>('month')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [data, setData] = useState<Computations | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getAuthed<Computations>(`/admin/accounts/${accountId}/computations`, {
        preset,
        ...(preset === 'custom' && from ? { from } : {}),
        ...(preset === 'custom' && to ? { to } : {}),
      })
      setData(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load computations')
    } finally {
      setLoading(false)
    }
  }, [accountId, preset, from, to])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Tabs value={preset} onValueChange={(v) => setPreset(v as 'day' | 'month' | 'custom')}>
          <TabsList>
            <TabsTrigger value="day">Today</TabsTrigger>
            <TabsTrigger value="month">This month</TabsTrigger>
            <TabsTrigger value="custom">Custom</TabsTrigger>
          </TabsList>
        </Tabs>
        {preset === 'custom' ? (
          <>
            <div>
              <Label htmlFor="cp-from" className="mb-1 block text-xs text-muted-foreground">
                From
              </Label>
              <Input id="cp-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" />
            </div>
            <div>
              <Label htmlFor="cp-to" className="mb-1 block text-xs text-muted-foreground">
                To
              </Label>
              <Input id="cp-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" />
            </div>
          </>
        ) : null}
      </div>

      {loading ? (
        <Skeleton className="h-40 rounded-lg" />
      ) : data ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardContent className="p-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Collections</p>
                <p className="mt-1.5 text-xl font-semibold">{fmtTZS(data.collection.totalAmount)}</p>
                <p className="text-xs text-muted-foreground">{data.collection.totalCount} records</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Disbursements</p>
                <p className="mt-1.5 text-xl font-semibold">{fmtTZS(data.disbursement.totalAmount)}</p>
                <p className="text-xs text-muted-foreground">{data.disbursement.totalCount} records</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">SMS</p>
                <p className="mt-1.5 text-xl font-semibold">{data.sms.totalCount}</p>
                <p className="text-xs text-muted-foreground">messages in range</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Batches</p>
                <p className="mt-1.5 text-xl font-semibold">{data.batches?.count ?? 0}</p>
                <p className="text-xs text-muted-foreground">
                  {data.batches?.totals?.success ?? 0} ok / {data.batches?.totals?.failed ?? 0} failed
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="animate-fade-in">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Wallet reconciliation (fraud scan)</CardTitle>
              <CardDescription>opening + credits − debits must equal closing; discrepancies are flagged.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Wallet</TableHead>
                    <TableHead className="text-right">Opening</TableHead>
                    <TableHead className="text-right">Credited</TableHead>
                    <TableHead className="text-right">Debited</TableHead>
                    <TableHead className="text-right">Closing</TableHead>
                    <TableHead className="text-right">Live</TableHead>
                    <TableHead>Ledger</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.wallets.map((w) => (
                    <TableRow key={w.walletType}>
                      <TableCell className="text-xs font-medium">{w.walletType}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmtTZS(w.openingBalance)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-emerald-600">{fmtTZS(w.totalCredited)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-red-600">{fmtTZS(w.totalDebited)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmtTZS(w.closingBalance)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmtTZS(w.liveBalance)}</TableCell>
                      <TableCell>
                        <Badge variant={w.ledgerConsistent ? 'success' : 'danger'}>
                          {w.ledgerConsistent ? 'consistent' : `Δ ${w.discrepancy}`}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.wallets.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-6 text-center text-xs text-muted-foreground">
                        No wallets
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------- API keys ------------------------------- */

function KeysTab({
  accountId,
  isAdmin,
  keys,
  onChanged,
}: {
  accountId: string
  isAdmin: boolean
  keys: ApiKeyRow[]
  onChanged: () => void
}) {
  const [issued, setIssued] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  async function issue() {
    setBusy(true)
    try {
      const res = await api.postAuthed<{ apiKey: string }>(`/admin/accounts/${accountId}/api-keys`, {})
      setIssued(res.apiKey)
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to issue key')
    } finally {
      setBusy(false)
    }
  }

  async function revoke(keyId: string) {
    try {
      await api.delAuthed(`/admin/accounts/${accountId}/api-keys/${keyId}`)
      toast.success('Key revoked')
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to revoke key')
    }
  }

  return (
    <Card className="animate-fade-in">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4" /> API keys
        </CardTitle>
        <CardDescription>
          Keys are shown once at issue time (only hashes are stored). Treat them like passwords.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAdmin ? (
          <Button onClick={issue} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Issue new key
          </Button>
        ) : null}

        {issued ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-800">
              Copy this key now — it will not be shown again
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-white px-2.5 py-2 font-mono text-xs">{issued}</code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(issued).then(() => toast('Key copied'))
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Status</TableHead>
              {isAdmin ? <TableHead className="text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((k) => (
              <TableRow key={k.id}>
                <TableCell className="text-xs font-medium">{k.name}</TableCell>
                <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
                <TableCell className="text-xs">{k.lastUsedAt ? fmtDateTime(k.lastUsedAt) : 'never'}</TableCell>
                <TableCell>
                  {k.revokedAt ? <Badge variant="danger">revoked</Badge> : <Badge variant="success">active</Badge>}
                </TableCell>
                {isAdmin ? (
                  <TableCell className="text-right">
                    {!k.revokedAt ? (
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmId(k.id)}>
                        Revoke
                      </Button>
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
            {keys.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isAdmin ? 5 : 4} className="py-6 text-center text-xs text-muted-foreground">
                  No keys issued yet
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        <Dialog open={confirmId !== null} onOpenChange={(v) => !v && setConfirmId(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Revoke this API key?</DialogTitle>
              <DialogDescription>
                Any integration using it will immediately lose access. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmId(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (confirmId) void revoke(confirmId)
                  setConfirmId(null)
                }}
              >
                Revoke key
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

/* ------------------------------ Permissions ------------------------------ */

function PermissionsTab({
  accountId,
  isAdmin,
  permissions,
  onChanged,
}: {
  accountId: string
  isAdmin: boolean
  permissions: ServicePermission[]
  onChanged: () => void
}) {
  const [rows, setRows] = useState<ServicePermission[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setRows(SERVICES.map((s) => permissions.find((p) => p.service === s) ?? { service: s, granted: false, meta: null }))
  }, [permissions])

  function update(service: string, patch: Partial<ServicePermission>) {
    setRows((rs) => rs.map((r) => (r.service === service ? { ...r, ...patch } : r)))
  }

  function updateMeta(service: string, patch: Record<string, unknown>) {
    setRows((rs) =>
      rs.map((r) => (r.service === service ? { ...r, meta: { ...(r.meta ?? {}), ...patch } as ServicePermission['meta'] } : r)),
    )
  }

  async function save() {
    setBusy(true)
    try {
      await api.putAuthed(`/admin/accounts/${accountId}/permissions`, {
        permissions: rows.map((r) => ({
          service: r.service,
          granted: r.granted,
          meta: r.meta ?? undefined,
        })),
      })
      toast.success('Permissions saved')
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save permissions')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="animate-fade-in">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Service permissions
        </CardTitle>
        <CardDescription>Grant services and fine-tune channel / wallet controls per account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {rows.map((r) => (
          <div key={r.service} className="rounded-md border p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">{r.service}</p>
                <p className="text-xs text-muted-foreground">
                  {r.service === 'SMS' ? 'Messaging via Beem' : r.service === 'COLLECTION' ? 'USSD-push collections via ClickPesa' : 'Payouts & batches via ClickPesa'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{r.granted ? 'granted' : 'denied'}</span>
                <Switch
                  checked={r.granted}
                  disabled={!isAdmin}
                  onCheckedChange={(v) => update(r.service, { granted: v })}
                  aria-label={`Toggle ${r.service}`}
                />
              </div>
            </div>
            {r.service !== 'SMS' ? (
              <>
                <Separator className="my-3" />
                <div className="flex flex-wrap items-center gap-5 text-xs">
                  <span className="text-muted-foreground">Channels</span>
                  {CHANNELS.map((c) => {
                    const active = (r.meta?.channels ?? []).includes(c)
                    return (
                      <label key={c} className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5"
                          checked={active}
                          disabled={!isAdmin || !r.granted}
                          onChange={(e) => {
                            const set = new Set(r.meta?.channels ?? [])
                            if (e.target.checked) set.add(c)
                            else set.delete(c)
                            updateMeta(r.service, { channels: Array.from(set) })
                          }}
                        />
                        {c}
                      </label>
                    )
                  })}
                  <label className="ml-auto flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5"
                      checked={r.meta?.payAsYouGo === true}
                      disabled={!isAdmin || !r.granted}
                      onChange={(e) => updateMeta(r.service, { payAsYouGo: e.target.checked })}
                    />
                    pay-as-you-go
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5"
                      checked={r.meta?.walletActions === true}
                      disabled={!isAdmin || !r.granted}
                      onChange={(e) => updateMeta(r.service, { walletActions: e.target.checked })}
                    />
                    wallet actions
                  </label>
                </div>
              </>
            ) : null}
          </div>
        ))}
        {isAdmin ? (
          <Button onClick={save} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save permissions
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Serviceman access is read-only.</p>
        )}
      </CardContent>
    </Card>
  )
}

/* ----------------------------- Suspend/activate ----------------------------- */

function SuspendButton({ accountId, onDone }: { accountId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (reason.trim().length < 3) {
      toast.error('Suspension reason is required')
      return
    }
    setBusy(true)
    try {
      await api.postAuthed(`/admin/accounts/${accountId}/suspend`, { suspendReason: reason.trim() })
      toast.success('Account suspended')
      setOpen(false)
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        <PauseCircle className="h-4 w-4" /> Suspend
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Suspend account</DialogTitle>
            <DialogDescription>
              All API keys stop working immediately and wallets are frozen for movement.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="sus-reason">Reason (audited)</Label>
            <Input id="sus-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Suspend
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ActivateButton({ accountId, onDone }: { accountId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await api.postAuthed(`/admin/accounts/${accountId}/activate`)
          toast.success('Account activated')
          onDone()
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Action failed')
        } finally {
          setBusy(false)
        }
      }}
    >
      <PlayCircle className="h-4 w-4" /> Activate
    </Button>
  )
}

/* ------------------------ Settlement & fees (req #1/#3/#4) ------------------------ */

interface SettlementRow {
  id: string
  type: 'MOBILE' | 'BANK'
  method?: string | null
  phoneNumber?: string | null
  bankName?: string | null
  bankInitials?: string | null
  accountNumber?: string | null
  accountName?: string | null
  isDefault: boolean
  isActive: boolean
}

interface FeeConfigRow {
  collectionBelowBps: number
  collectionThreshold: string
  collectionAboveBps: number
  disbursementBelowBps: number
  disbursementThreshold: string
  disbursementAboveBps: number
  transferBps: number
}

function SettlementFeesTab({
  accountId,
  isAdmin,
  autoSweep,
  onChanged,
}: {
  accountId: string
  isAdmin: boolean
  autoSweep?: boolean
  onChanged: () => void
}) {
  const [settlements, setSettlements] = useState<SettlementRow[]>([])
  const [fees, setFees] = useState<FeeConfigRow | null>(null)
  const [sweep, setSweep] = useState(autoSweep ?? true)
  const [busy, setBusy] = useState('')
  // add-settlement form
  const [stType, setStType] = useState<'MOBILE' | 'BANK'>('MOBILE')
  const [stMethod, setStMethod] = useState('AIRTEL')
  const [stPhone, setStPhone] = useState('')
  const [stBank, setStBank] = useState('')
  const [stInit, setStInit] = useState('')
  const [stAcc, setStAcc] = useState('')
  const [stAccName, setStAccName] = useState('')

  const load = useCallback(async () => {
    try {
      const s = await api.getAuthed<{ data: SettlementRow[] }>(`/admin/accounts/${accountId}/settlement`)
      setSettlements(s.data ?? [])
      const f = await api.getAuthed<FeeConfigRow & { data?: FeeConfigRow }>(`/admin/accounts/${accountId}/fees`)
      setFees((f?.data ?? f) as FeeConfigRow)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load settlement data')
    }
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  async function addSettlement() {
    setBusy('add')
    try {
      const payload =
        stType === 'MOBILE'
          ? { type: 'MOBILE', method: stMethod, phoneNumber: stPhone.trim() }
          : { type: 'BANK', bankName: stBank.trim(), bankInitials: stInit.trim() || undefined, accountNumber: stAcc.trim(), accountName: stAccName.trim() || undefined }
      await api.postAuthed(`/admin/accounts/${accountId}/settlement`, payload)
      toast.success('Settlement account saved (now the default)')
      setStPhone(''); setStBank(''); setStInit(''); setStAcc(''); setStAccName('')
      await load()
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save settlement account')
    } finally {
      setBusy('')
    }
  }

  async function saveFees() {
    if (!fees) return
    setBusy('fees')
    try {
      await api.putAuthed(`/admin/accounts/${accountId}/fees`, {
        collectionBelowBps: Number(fees.collectionBelowBps),
        collectionThreshold: String(fees.collectionThreshold),
        collectionAboveBps: Number(fees.collectionAboveBps),
        disbursementBelowBps: Number(fees.disbursementBelowBps),
        disbursementThreshold: String(fees.disbursementThreshold),
        disbursementAboveBps: Number(fees.disbursementAboveBps),
        transferBps: Number(fees.transferBps),
      })
      toast.success('Fee schedule updated — applied to all future transactions')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update fees')
    } finally {
      setBusy('')
    }
  }

  async function toggleSweep(v: boolean) {
    setBusy('sweep')
    try {
      await api.putAuthed(`/admin/accounts/${accountId}/settlement/auto-sweep`, { enabled: v })
      setSweep(v)
      toast.success(v ? 'Auto-sweep enabled (00:00 EAT daily)' : 'Auto-sweep disabled')
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to toggle auto-sweep')
    } finally {
      setBusy('')
    }
  }

  async function sweepNow() {
    setBusy('sweepNow')
    try {
      const res = await api.postAuthed<{ payout?: { reference?: string }; payoutAmount?: string }>(`/admin/accounts/${accountId}/settlement/sweep-now`)
      toast.success(`Sweep initiated — ${fmtTZS(res?.payoutAmount ?? '0')} to the settlement account (${res?.payout?.reference ?? ''})`)
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Sweep failed')
    } finally {
      setBusy('')
    }
  }

  const bpsField = (label: string, key: keyof FeeConfigRow, suffix: string) =>
    fees ? (
      <div className="space-y-1.5">
        <Label htmlFor={`fee-${key}`}>{label}</Label>
        <div className="flex items-center gap-2">
          <Input
            id={`fee-${key}`}
            inputMode="numeric"
            value={String(fees[key] ?? '')}
            onChange={(e) => setFees({ ...fees, [key]: e.target.value.replace(/\D/g, '') } as FeeConfigRow)}
            maxLength={5}
            className="w-24"
          />
          <span className="text-xs text-muted-foreground">{suffix}</span>
        </div>
      </div>
    ) : null

  return (
    <div className="space-y-5 pt-4">
      <Card className="animate-fade-in">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Settlement accounts</CardTitle>
          <CardDescription>Collected funds settle here (daily 00:00 EAT sweep and manual withdrawals).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {settlements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No settlement account yet — add one below to enable sweeps.</p>
          ) : (
            <div className="space-y-2">
              {settlements.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                  <div>
                    <p className="font-medium">
                      {s.type === 'BANK'
                        ? `${s.bankName}${s.bankInitials ? ` (${s.bankInitials})` : ''} · ${s.accountNumber}`
                        : `${s.method} · ${s.phoneNumber}`}
                    </p>
                    {s.accountName ? <p className="text-xs text-muted-foreground">{s.accountName}</p> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {s.isDefault ? <Badge variant="info">default</Badge> : null}
                    <Badge variant={s.isActive ? 'success' : 'muted'}>{s.isActive ? 'active' : 'inactive'}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}

          {isAdmin ? (
            <div className="space-y-3 rounded-md border border-dashed p-3">
              <p className="text-xs font-medium text-muted-foreground">Add settlement account</p>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" size="sm" variant={stType === 'MOBILE' ? 'secondary' : 'outline'} onClick={() => setStType('MOBILE')}>
                  Mobile money
                </Button>
                <Button type="button" size="sm" variant={stType === 'BANK' ? 'secondary' : 'outline'} onClick={() => setStType('BANK')}>
                  Bank account
                </Button>
              </div>
              {stType === 'MOBILE' ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Method</Label>
                    <Select value={stMethod} onValueChange={setStMethod}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AIRTEL">Airtel</SelectItem>
                        <SelectItem value="TIGO">Tigo</SelectItem>
                        <SelectItem value="VODACOM">Vodacom</SelectItem>
                        <SelectItem value="HALOPESA">Halopesa</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sa-phone">Phone</Label>
                    <Input id="sa-phone" value={stPhone} onChange={(e) => setStPhone(e.target.value)} maxLength={15} placeholder="0781234567" />
                  </div>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="sa-bank">Bank name</Label>
                    <Input id="sa-bank" value={stBank} onChange={(e) => setStBank(e.target.value)} maxLength={80} placeholder="CRDB Bank" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sa-init">Bank initials</Label>
                    <Input id="sa-init" value={stInit} onChange={(e) => setStInit(e.target.value)} maxLength={12} placeholder="CRDB" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sa-acc">Account number</Label>
                    <Input id="sa-acc" value={stAcc} onChange={(e) => setStAcc(e.target.value)} maxLength={40} placeholder="0676544740" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sa-accname">Account name</Label>
                    <Input id="sa-accname" value={stAccName} onChange={(e) => setStAccName(e.target.value)} maxLength={80} placeholder="ACME LTD" />
                  </div>
                </div>
              )}
              <Button size="sm" onClick={addSettlement} disabled={busy === 'add'}>
                {busy === 'add' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Save settlement account
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="animate-fade-in">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Auto-sweep</CardTitle>
          <CardDescription>Settles the whole COLLECTION wallet balance into the default settlement account daily at 00:00 Africa/Dar_es_Salaam.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Switch checked={sweep} onCheckedChange={(v) => (isAdmin ? toggleSweep(v) : setSweep(v))} disabled={!isAdmin || busy === 'sweep'} aria-label="auto sweep" />
            <span className="text-sm">{sweep ? 'Enabled' : 'Disabled'}</span>
          </div>
          {isAdmin ? (
            <Button variant="outline" size="sm" onClick={sweepNow} disabled={busy === 'sweepNow'}>
              {busy === 'sweepNow' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Sweep now
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card className="animate-fade-in">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Custom fee schedule</CardTitle>
          <CardDescription>
            Basis points (500 = 5%). Defaults: 5% below 3,000 TZS and 2% at/above — applied to every collection and disbursement; transfers default 2%.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            {bpsField('Collection below-threshold', 'collectionBelowBps', 'bps')}
            {bpsField('Collection above-threshold', 'collectionAboveBps', 'bps')}
            {fees ? (
              <div className="space-y-1.5">
                <Label htmlFor="fee-threshold">Collection threshold (TZS)</Label>
                <Input
                  id="fee-threshold"
                  inputMode="decimal"
                  value={String(fees.collectionThreshold ?? '')}
                  onChange={(e) => setFees({ ...fees, collectionThreshold: e.target.value } as FeeConfigRow)}
                  className="w-32"
                />
              </div>
            ) : null}
            {bpsField('Disbursement below-threshold', 'disbursementBelowBps', 'bps')}
            {bpsField('Disbursement above-threshold', 'disbursementAboveBps', 'bps')}
            {fees ? (
              <div className="space-y-1.5">
                <Label htmlFor="fee-dthreshold">Disbursement threshold (TZS)</Label>
                <Input
                  id="fee-dthreshold"
                  inputMode="decimal"
                  value={String(fees.disbursementThreshold ?? '')}
                  onChange={(e) => setFees({ ...fees, disbursementThreshold: e.target.value } as FeeConfigRow)}
                  className="w-32"
                />
              </div>
            ) : null}
            {bpsField('Wallet transfer fee', 'transferBps', 'bps')}
          </div>
          {isAdmin ? (
            <Button size="sm" onClick={saveFees} disabled={busy === 'fees'}>
              {busy === 'fees' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save fee schedule
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
