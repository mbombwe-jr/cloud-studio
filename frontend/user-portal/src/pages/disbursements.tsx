import { useCallback, useEffect, useState } from 'react'
import { Banknote, Loader2, Smartphone, Layers, LinkIcon } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { fmtTZS, fmtDateTime } from '@/lib/format'
import type { Payout, DisbursementBatch, Paged } from '@/lib/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

export default function DisbursementsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Disbursements</h1>
        <p className="text-sm text-muted-foreground">Mobile-money and bank payouts</p>
      </div>

      <Tabs defaultValue="new">
        <TabsList>
          <TabsTrigger value="new">New payout</TabsTrigger>
          <TabsTrigger value="links">Payout links</TabsTrigger>
          <TabsTrigger value="history">Payouts</TabsTrigger>
          <TabsTrigger value="batches">Batches</TabsTrigger>
        </TabsList>
        <TabsContent value="new">
          <NewPayoutCard />
        </TabsContent>
        <TabsContent value="links">
          <PayoutLinksCard />
        </TabsContent>
        <TabsContent value="history">
          <PayoutHistory />
        </TabsContent>
        <TabsContent value="batches">
          <BatchList />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function NewPayoutCard() {
  const [channel, setChannel] = useState<'MOBILE_MONEY' | 'BANK'>('MOBILE_MONEY')
  const [amount, setAmount] = useState('')
  const [phone, setPhone] = useState('255')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountName, setAccountName] = useState('')
  const [bic, setBic] = useState('')
  const [transferType, setTransferType] = useState<'ACH' | 'RTGS'>('ACH')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!/^\d+(\.\d{1,2})?$/.test(amount.trim()) || Number(amount) <= 0) {
      toast.error('Enter a valid positive amount')
      return
    }
    setBusy(true)
    try {
      if (channel === 'MOBILE_MONEY') {
        if (!/^255[67]\d{8}$/.test(phone.trim())) {
          toast.error('Phone must look like 255712345678')
          return
        }
        const res = await api.postKeyed<Record<string, unknown>>('/disbursements/mobile-money', {
          amount: amount.trim(),
          phoneNumber: phone.trim(),
          ...(reference.trim() ? { reference: reference.trim() } : {}),
        })
        toast.success(`Payout submitted${res?.reference ? ` — ${String(res.reference)}` : ''}`)
      } else {
        if (accountNumber.trim().length < 3) {
          toast.error('Account number is required')
          return
        }
        if (accountName.trim().length < 3) {
          toast.error('Account name is required')
          return
        }
        if (!/^[A-Za-z]{6}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$/.test(bic.trim())) {
          toast.error('BIC must be a valid SWIFT code, e.g. ACTZTZTZ')
          return
        }
        const res = await api.postKeyed<Record<string, unknown>>('/disbursements/bank', {
          amount: amount.trim(),
          accountNumber: accountNumber.trim(),
          accountName: accountName.trim(),
          bic: bic.trim().toUpperCase(),
          transferType,
          ...(reference.trim() ? { reference: reference.trim() } : {}),
        })
        toast.success(`Payout submitted${res?.reference ? ` — ${String(res.reference)}` : ''}`)
      }
      setAmount('')
      setReference('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Payout failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="animate-fade-in">
      <CardHeader>
        <CardTitle>Create payout</CardTitle>
        <CardDescription>Funds are debited from your DISBURSEMENT wallet.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid max-w-md grid-cols-2 gap-2">
          <Button
            variant={channel === 'MOBILE_MONEY' ? 'default' : 'outline'}
            onClick={() => setChannel('MOBILE_MONEY')}
          >
            <Smartphone className="h-4 w-4" /> Mobile money
          </Button>
          <Button variant={channel === 'BANK' ? 'default' : 'outline'} onClick={() => setChannel('BANK')}>
            <Banknote className="h-4 w-4" /> Bank transfer
          </Button>
        </div>

        <div className="grid max-w-2xl gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="d-amount">Amount (TZS)</Label>
            <Input id="d-amount" inputMode="decimal" placeholder="15000" value={amount} onChange={(e) => setAmount(e.target.value)} maxLength={15} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-ref">Client reference (optional)</Label>
            <Input id="d-ref" placeholder="SAL-091" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={15} />
          </div>

          {channel === 'MOBILE_MONEY' ? (
            <div className="space-y-1.5">
              <Label htmlFor="d-phone">Beneficiary phone</Label>
              <Input id="d-phone" inputMode="tel" placeholder="255712345678" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={12} />
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="d-accnum">Account number</Label>
                <Input id="d-accnum" placeholder="015XXXXXXX" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} maxLength={30} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-accname">Account name</Label>
                <Input id="d-accname" placeholder="JOHN DOE" value={accountName} onChange={(e) => setAccountName(e.target.value)} maxLength={100} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-bic">Bank SWIFT/BIC</Label>
                <Input id="d-bic" placeholder="ACTZTZTZ" value={bic} onChange={(e) => setBic(e.target.value)} maxLength={11} />
              </div>
              <div className="space-y-1.5">
                <Label>Transfer type</Label>
                <Select value={transferType} onValueChange={(v) => setTransferType(v as 'ACH' | 'RTGS')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACH">ACH</SelectItem>
                    <SelectItem value="RTGS">RTGS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>

        <Button onClick={submit} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Submit payout
        </Button>
      </CardContent>
    </Card>
  )
}

function PayoutHistory() {
  const [rows, setRows] = useState<Payout[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<Payout | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getKeyed<Paged<Payout>>('/disbursements', { page, limit: 15 })
      setRows(res.data)
      setTotalPages(res.meta?.pagination?.totalPages ?? 1)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load payouts')
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Card className="animate-fade-in">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Payouts</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
            Prev
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page} / {totalPages}
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
          <p className="py-8 text-center text-sm text-muted-foreground">No payouts yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id} className="cursor-pointer" onClick={() => setDetail(p)}>
                  <TableCell className="font-mono text-xs">{p.reference}</TableCell>
                  <TableCell className="text-xs">{p.channel.replaceAll('_', ' ')}</TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold">{fmtTZS(p.amount)}</TableCell>
                  <TableCell>
                    <StatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(p.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Dialog open={detail !== null} onOpenChange={(v) => !v && setDetail(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-mono text-base">{detail?.reference}</DialogTitle>
              <DialogDescription>Payout detail</DialogDescription>
            </DialogHeader>
            {detail ? (
              <div className="space-y-2 text-sm">
                <Row label="Status" value={<StatusBadge status={detail.status} />} />
                <Row label="Amount" value={fmtTZS(detail.amount)} />
                <Row label="Channel" value={detail.channel.replaceAll('_', ' ')} />
                {detail.phoneNumber ? <Row label="Phone" value={detail.phoneNumber} mono /> : null}
                {detail.bankAccountNumber ? <Row label="Account" value={detail.bankAccountNumber} mono /> : null}
                {detail.bankAccountName ? <Row label="Account name" value={detail.bankAccountName} /> : null}
                <Row label="Created" value={fmtDateTime(detail.createdAt)} />
                <Row label="Completed" value={detail.completedAt ? fmtDateTime(detail.completedAt) : '—'} />
              </div>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => setDetail(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

function BatchList() {
  const [rows, setRows] = useState<DisbursementBatch[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    api
      .getKeyed<Paged<DisbursementBatch>>('/disbursements/batches', { page: 1, limit: 20 })
      .then((r) => alive && setRows(r.data))
      .catch(() => alive && setRows([]))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  return (
    <Card className="animate-fade-in">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-4 w-4" /> Batches
        </CardTitle>
        <CardDescription>Bulk payouts are created via the API (POST /disbursements/batches).</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No batches yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-center">Success</TableHead>
                <TableHead className="text-center">Failed</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-mono text-xs">{b.reference}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-xs">{b.name}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{fmtTZS(b.totalAmount)}</TableCell>
                  <TableCell className="text-center text-xs text-emerald-600">{b.successCount}</TableCell>
                  <TableCell className="text-center text-xs text-red-600">{b.failedCount}</TableCell>
                  <TableCell>
                    <StatusBadge status={b.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
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

function PayoutLinksCard() {
  const [amount, setAmount] = useState('')
  const [expiry, setExpiry] = useState('15')
  const [createdLink, setCreatedLink] = useState<{ url: string; amount: string; expiresAt: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function createLink() {
    if (!/^\d+(\.\d{1,2})?$/.test(amount.trim()) || Number(amount) <= 0) {
      toast.error('Enter a valid positive amount')
      return
    }
    const mins = parseInt(expiry) || 15
    if (mins < 1 || mins > 1440) {
      toast.error('Expiry must be between 1 and 1440 minutes')
      return
    }

    setBusy(true)
    try {
      const res = await api.postKeyed<{ url: string; amount: string; expiresAt: string }>('/disbursements/links', {
        amount: amount.trim(),
        expiresInMinutes: mins,
      })
      setCreatedLink(res)
      toast.success('Payout link created')
      setAmount('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create link')
    } finally {
      setBusy(false)
    }
  }

  function copyLink() {
    if (!createdLink) return
    navigator.clipboard.writeText(createdLink.url)
    toast.success('Link copied to clipboard')
  }

  return (
    <Card className="animate-fade-in">
      <CardHeader>
        <CardTitle>Create payout link</CardTitle>
        <CardDescription>Generate a one-time link to share a fixed-amount payout</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {createdLink ? (
          <div className="space-y-4">
            <div className="rounded-lg border p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{fmtTZS(createdLink.amount)}</div>
                  <div className="text-sm text-muted-foreground">Expires: {fmtDateTime(createdLink.expiresAt)}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={copyLink}>
                  Copy
                </Button>
              </div>
              <div className="mt-3">
                <Input readOnly value={createdLink.url} className="font-mono text-xs" />
              </div>
            </div>
            <Button variant="outline" onClick={() => setCreatedLink(null)}>
              Create another link
            </Button>
          </div>
        ) : (
          <div className="grid max-w-2xl gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pl-amount">Amount (TZS)</Label>
              <Input id="pl-amount" inputMode="decimal" placeholder="15000" value={amount} onChange={(e) => setAmount(e.target.value)} maxLength={15} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pl-expiry">Expires in (minutes)</Label>
              <Input id="pl-expiry" type="number" min="1" max="1440" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <Button onClick={createLink} disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LinkIcon className="mr-2 h-4 w-4" />}
                Create payout link
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
