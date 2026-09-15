import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Building2, Loader2, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { fmtDate } from '@/lib/format'
import type { AccountRow, Paged } from '@/lib/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
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

export default function AccountsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'

  const [rows, setRows] = useState<AccountRow[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('ALL')
  const [createOpen, setCreateOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getAuthed<Paged<AccountRow>>('/admin/accounts', {
        page,
        limit: 15,
        ...(status !== 'ALL' ? { status } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
      })
      setRows(res.data)
      setTotalPages(res.meta?.pagination?.totalPages ?? 1)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load accounts')
    } finally {
      setLoading(false)
    }
  }, [page, status, search])

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 350 : 0)
    return () => clearTimeout(t)
  }, [load, search])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Accounts</h1>
          <p className="text-sm text-muted-foreground">Client accounts opened on the platform</p>
        </div>
        {isAdmin ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New account
          </Button>
        ) : null}
      </div>

      <Card className="animate-fade-in">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search name / ID…"
              value={search}
              onChange={(e) => {
                setPage(1)
                setSearch(e.target.value)
              }}
              maxLength={80}
            />
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v)
                setPage(1)
              }}
            >
              <SelectTrigger className="h-9 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="SUSPENDED">Suspended</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
              Prev
            </Button>
            <span className="text-xs text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center">
              <Building2 className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-2 text-sm text-muted-foreground">No accounts match your filters.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Public ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.id} className="cursor-pointer">
                    <TableCell>
                      <Link to={`/accounts/${a.accountId}`} className="font-medium hover:underline">
                        {a.accountName}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{a.accountId}</TableCell>
                    <TableCell>
                      <StatusBadge status={a.status} />
                    </TableCell>
                    <TableCell className="text-xs">{a.contactEmail ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{fmtDate(a.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateAccountDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => {
        setPage(1)
        void load()
      }} />
    </div>
  )
}

function CreateAccountDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [billing, setBilling] = useState<'PREPAID' | 'POSTPAID'>('PREPAID')
  const [busy, setBusy] = useState(false)
  // settlement details (requirement #1)
  const [settleType, setSettleType] = useState<'MOBILE' | 'BANK'>('MOBILE')
  const [settleMethod, setSettleMethod] = useState<'AIRTEL' | 'TIGO' | 'VODACOM' | 'HALOPESA'>('AIRTEL')
  const [settlePhone, setSettlePhone] = useState('')
  const [bankName, setBankName] = useState('')
  const [bankInitials, setBankInitials] = useState('')
  const [bankAccount, setBankAccount] = useState('')
  const [bankAccountName, setBankAccountName] = useState('')
  const [autoSweep, setAutoSweep] = useState(true)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (name.trim().length < 2) {
      toast.error('Account name must be at least 2 characters')
      return
    }
    let settlement: Record<string, unknown> | undefined
    if (settleType === 'MOBILE') {
      if (settlePhone.trim()) {
        if (!/^(\+?255|0)?[67]\d{8}$/.test(settlePhone.trim())) {
          toast.error('Settlement phone must be a Tanzanian mobile number, e.g. 0781234567')
          return
        }
        settlement = { type: 'MOBILE', method: settleMethod, phoneNumber: settlePhone.trim() }
      }
    } else if (bankAccount.trim() && bankName.trim()) {
      settlement = {
        type: 'BANK',
        bankName: bankName.trim(),
        bankInitials: bankInitials.trim() || undefined,
        accountNumber: bankAccount.trim(),
        accountName: bankAccountName.trim() || undefined,
      }
    }
    setBusy(true)
    try {
      const res = await api.postAuthed<Record<string, unknown>>('/admin/accounts', {
        accountName: name.trim(),
        billingMode: billing,
        autoSweep,
        ...(email.trim() ? { contactEmail: email.trim() } : {}),
        ...(phone.trim() ? { contactPhone: phone.trim() } : {}),
        ...(settlement ? { settlement } : {}),
      })
      toast.success(`Account created${res?.accountId ? ` — ${String(res.accountId)}` : ''}`)
      onOpenChange(false)
      setName('')
      setEmail('')
      setPhone('')
      onCreated()
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message)
      else toast.error('Failed to create account')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Open a new account</DialogTitle>
          <DialogDescription>
            Step 1 of onboarding. Settlement details route daily auto-sweeps and withdrawals — there is no manual settlement method.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="na-name">Account name *</Label>
            <Input id="na-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Acme Ltd" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="na-email">Contact email</Label>
              <Input id="na-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} placeholder="ops@acme.co.tz" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="na-phone">Contact phone</Label>
              <Input id="na-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} placeholder="+255…" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Billing mode</Label>
            <Select value={billing} onValueChange={(v) => setBilling(v as 'PREPAID' | 'POSTPAID')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PREPAID">PREPAID</SelectItem>
                <SelectItem value="POSTPAID">POSTPAID</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm font-medium">Settlement account (optional here — required before sweeps)</p>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={settleType === 'MOBILE' ? 'secondary' : 'outline'} className="text-xs" onClick={() => setSettleType('MOBILE')}>
                Mobile money
              </Button>
              <Button type="button" variant={settleType === 'BANK' ? 'secondary' : 'outline'} className="text-xs" onClick={() => setSettleType('BANK')}>
                Bank account
              </Button>
            </div>
            {settleType === 'MOBILE' ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Method</Label>
                  <Select value={settleMethod} onValueChange={(v) => setSettleMethod(v as typeof settleMethod)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AIRTEL">Airtel</SelectItem>
                      <SelectItem value="TIGO">Tigo</SelectItem>
                      <SelectItem value="VODACOM">Vodacom</SelectItem>
                      <SelectItem value="HALOPESA">Halopesa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="st-phone">Phone number</Label>
                  <Input id="st-phone" value={settlePhone} onChange={(e) => setSettlePhone(e.target.value)} maxLength={15} placeholder="0781234567" />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="st-bank">Bank name *</Label>
                  <Input id="st-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} maxLength={80} placeholder="CRDB Bank" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="st-init">Bank initials</Label>
                  <Input id="st-init" value={bankInitials} onChange={(e) => setBankInitials(e.target.value)} maxLength={12} placeholder="CRDB" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="st-acc">Account number *</Label>
                  <Input id="st-acc" value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} maxLength={40} placeholder="0676544740" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="st-accname">Account name</Label>
                  <Input id="st-accname" value={bankAccountName} onChange={(e) => setBankAccountName(e.target.value)} maxLength={80} placeholder="ACME LTD" />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Auto-sweep</p>
              <p className="text-xs text-muted-foreground">Settle the collection wallet to the settlement account daily at 00:00 EAT</p>
            </div>
            <Switch checked={autoSweep} onCheckedChange={setAutoSweep} aria-label="auto sweep" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
