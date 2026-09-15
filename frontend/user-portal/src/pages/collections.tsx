import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, Radar } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { fmtTZS, fmtDateTime } from '@/lib/format'
import type { Collection, Paged, PageMeta } from '@/lib/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
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
import { StatusBadge } from '@/components/status-badge'

interface PreviewResult {
  [k: string]: unknown
}

export default function CollectionsPage() {
  // form
  const [amount, setAmount] = useState('')
  const [phone, setPhone] = useState('255')
  const [reference, setReference] = useState('')
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [busy, setBusy] = useState<'preview' | 'push' | null>(null)

  // list
  const [rows, setRows] = useState<Collection[]>([])
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [page, setPage] = useState(1)
  const [listLoading, setListLoading] = useState(true)
  const [detail, setDetail] = useState<Collection | null>(null)

  const load = useCallback(async () => {
    setListLoading(true)
    try {
      const res = await api.getKeyed<Paged<Collection>>('/collections', { page, limit: 15 })
      setRows(res.data)
      setMeta(res.meta)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load collections')
    } finally {
      setListLoading(false)
    }
  }, [page])

  useEffect(() => {
    void load()
  }, [load])

  function validPhone(p: string): boolean {
    return /^255[67]\d{8}$/.test(p.trim())
  }

  async function doPreview() {
    if (!/^\d+(\.\d{1,2})?$/.test(amount.trim()) || Number(amount) <= 0) {
      toast.error('Enter a valid positive amount')
      return
    }
    if (!validPhone(phone)) {
      toast.error('Phone must look like 255712345678')
      return
    }
    setBusy('preview')
    setPreview(null)
    try {
      const res = await api.postKeyed<PreviewResult>('/collections/ussd-push/preview', {
        amount: amount.trim(),
        phoneNumber: phone.trim(),
        fetchSenderDetails: true,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      })
      setPreview(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setBusy(null)
    }
  }

  async function doPush() {
    if (!/^\d+(\.\d{1,2})?$/.test(amount.trim()) || Number(amount) <= 0) {
      toast.error('Enter a valid positive amount')
      return
    }
    if (!validPhone(phone)) {
      toast.error('Phone must look like 255712345678')
      return
    }
    setBusy('push')
    try {
      const res = await api.postKeyed<Record<string, unknown>>('/collections/ussd-push', {
        amount: amount.trim(),
        phoneNumber: phone.trim(),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      })
      toast.success(`USSD push sent${res?.reference ? ` — ${String(res.reference)}` : ''}`)
      setPreview(null)
      setAmount('')
      setReference('')
      setPage(1)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Push failed')
    } finally {
      setBusy(null)
    }
  }

  async function refreshOne(ref: string) {
    try {
      await api.postKeyed(`/collections/${ref}/refresh`)
      toast.success(`Status refreshed for ${ref}`)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Refresh failed')
    }
  }

  const totalPages = meta?.pagination?.totalPages ?? 1

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Collections</h1>
        <p className="text-sm text-muted-foreground">Mobile-money collections via USSD push</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="animate-fade-in xl:col-span-1">
          <CardHeader>
            <CardTitle>New USSD push</CardTitle>
            <CardDescription>Prompts the customer's phone to approve a payment.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="c-amount">Amount (TZS)</Label>
              <Input id="c-amount" inputMode="decimal" placeholder="15000" value={amount} onChange={(e) => setAmount(e.target.value)} maxLength={15} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-phone">Customer phone</Label>
              <Input id="c-phone" inputMode="tel" placeholder="255712345678" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={12} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-ref">Client reference (optional)</Label>
              <Input id="c-ref" placeholder="ORDER-42" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={15} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={doPreview} disabled={busy !== null}>
                {busy === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
                Preview charges
              </Button>
              <Button className="flex-1" onClick={doPush} disabled={busy !== null}>
                {busy === 'push' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Send push
              </Button>
            </div>
            {preview ? (
              <div className="rounded-md border bg-muted/40 p-3">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview result</p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed">
                  {JSON.stringify(preview, null, 2)}
                </pre>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="animate-fade-in xl:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>History</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || listLoading} onClick={() => setPage((p) => p - 1)}>
                Prev
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {page} / {totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= totalPages || listLoading} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {listLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No collections yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => setDetail(c)}>
                      <TableCell className="font-mono text-xs">{c.reference}</TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold">{fmtTZS(c.amount)}</TableCell>
                      <TableCell>
                        <StatusBadge status={c.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(c.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            void refreshOne(c.reference)
                          }}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={detail !== null} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-base">{detail?.reference}</DialogTitle>
            <DialogDescription>Collection detail</DialogDescription>
          </DialogHeader>
          {detail ? (
            <div className="space-y-2 text-sm">
              <Row label="Status" value={<StatusBadge status={detail.status} />} />
              <Row label="Amount" value={fmtTZS(detail.amount)} />
              <Row label="Collected" value={detail.collectedAmount ? fmtTZS(detail.collectedAmount) : '—'} />
              <Row label="Channel" value={detail.channel} />
              <Row label="Phone" value={detail.phoneNumber ?? '—'} mono />
              <Row label="Currency" value={detail.currency} />
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
