import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { fmtDateTime } from '@/lib/format'
import type { Paged, SmsMessage } from '@/lib/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/status-badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface SenderNames {
  dedicated: { id: string; name: string; isApproved: boolean }[]
  shared: { id: string; name: string; isApproved: boolean }[]
}

/** Normalize a Tanzanian number to 255[67]xxxxxxxx where possible. */
function normalize(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '')
  let n = digits.startsWith('+') ? digits.slice(1) : digits
  if (n.startsWith('0')) n = `255${n.slice(1)}`
  if (/^255[67]\d{8}$/.test(n)) return n
  if (/^[67]\d{8}$/.test(n)) return `255${n}`
  return null
}

export default function SmsPage() {
  // compose
  const [senders, setSenders] = useState<SenderNames | null>(null)
  const [senderChoice, setSenderChoice] = useState<string>('default')
  const [message, setMessage] = useState('')
  const [recipientsText, setRecipientsText] = useState('')
  const [busy, setBusy] = useState(false)

  // history
  const [rows, setRows] = useState<SmsMessage[]>([])
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    api
      .getKeyed<SenderNames>('/sms/sender-names')
      .then((s) => alive && setSenders(s))
      .catch(() => alive && setSenders(null))
    return () => {
      alive = false
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getKeyed<Paged<SmsMessage>>('/sms', {
        page,
        limit: 15,
        ...(statusFilter !== 'ALL' ? { status: statusFilter } : {}),
      })
      setRows(res.data)
      setTotalPages(res.meta?.pagination?.totalPages ?? 1)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load SMS history')
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter])

  useEffect(() => {
    void load()
  }, [load])

  const parsed = useMemo(() => {
    const lines = recipientsText
      .split(/[\n,;]+/)
      .map((l) => l.trim())
      .filter(Boolean)
    const valid: string[] = []
    const invalid: string[] = []
    for (const l of lines) {
      const n = normalize(l)
      if (n) valid.push(n)
      else invalid.push(l)
    }
    return { valid: Array.from(new Set(valid)), invalid }
  }, [recipientsText])

  const segments = message.length === 0 ? 0 : Math.ceil(message.length / 160)

  async function submit() {
    if (message.trim().length === 0) {
      toast.error('Message is required')
      return
    }
    if (message.length > 1600) {
      toast.error('Message too long (max 1600 characters)')
      return
    }
    if (parsed.valid.length === 0) {
      toast.error('At least one valid Tanzanian recipient is required')
      return
    }
    if (parsed.valid.length > 250) {
      toast.error('At most 250 recipients per request')
      return
    }
    setBusy(true)
    try {
      const body: Record<string, unknown> = {
        message: message,
        recipients: parsed.valid,
      }
      if (senderChoice !== 'default') body.senderName = senderChoice
      const res = await api.postKeyed<Record<string, unknown>>('/sms/send', body)
      toast.success(
        `SMS queued for ${parsed.valid.length} recipient${parsed.valid.length === 1 ? '' : 's'}${
          res?.reference ? ` — ${String(res.reference)}` : ''
        }`,
      )
      setMessage('')
      setRecipientsText('')
      setPage(1)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">SMS</h1>
        <p className="text-sm text-muted-foreground">Send messages and track delivery</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="animate-fade-in xl:col-span-1">
          <CardHeader>
            <CardTitle>Compose</CardTitle>
            <CardDescription>Recipients are normalized to 255… and de-duplicated automatically.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Sender name</Label>
              <Select value={senderChoice} onValueChange={setSenderChoice}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Account default</SelectItem>
                  {(senders?.dedicated ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.name}>
                      {s.name} {s.isApproved ? '' : '(pending)'}
                    </SelectItem>
                  ))}
                  {(senders?.shared ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.name}>
                      {s.name} (shared)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="s-msg">Message</Label>
                <span className="text-[11px] text-muted-foreground">
                  {message.length}/1600 · {segments} segment{segments === 1 ? '' : 's'}
                </span>
              </div>
              <Textarea
                id="s-msg"
                rows={5}
                placeholder="Your message to customers…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={1600}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="s-rcpt">Recipients (one per line)</Label>
                <span className="text-[11px] text-muted-foreground">{parsed.valid.length} valid</span>
              </div>
              <Textarea
                id="s-rcpt"
                rows={4}
                className="font-mono text-xs"
                placeholder={'0712345678\n255712345678'}
                value={recipientsText}
                onChange={(e) => setRecipientsText(e.target.value)}
              />
              {parsed.invalid.length > 0 ? (
                <p className="text-[11px] text-amber-600">
                  {parsed.invalid.length} invalid number{parsed.invalid.length === 1 ? '' : 's'} will be skipped
                </p>
              ) : null}
            </div>
            <Button onClick={submit} disabled={busy} className="w-full">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send to {parsed.valid.length} recipient{parsed.valid.length === 1 ? '' : 's'}
            </Button>
          </CardContent>
        </Card>

        <Card className="animate-fade-in xl:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>History</CardTitle>
            <div className="flex items-center gap-2">
              <Select
                value={statusFilter}
                onValueChange={(v) => {
                  setStatusFilter(v)
                  setPage(1)
                }}
              >
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All statuses</SelectItem>
                  <SelectItem value="QUEUED">Queued</SelectItem>
                  <SelectItem value="PROCESSING">Processing</SelectItem>
                  <SelectItem value="SENT">Sent</SelectItem>
                  <SelectItem value="DELIVERED">Delivered</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
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
              <p className="py-8 text-center text-sm text-muted-foreground">No messages found.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Sender</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead className="text-center">Recipients</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((m) => {
                    const count =
                      m.recipientCount ??
                      (Array.isArray(m.recipients) ? m.recipients.length : 0)
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(m.createdAt)}</TableCell>
                        <TableCell className="text-xs font-medium">{m.senderName ?? 'default'}</TableCell>
                        <TableCell className="max-w-[260px]">
                          <p className="truncate text-xs">{m.message}</p>
                          <p className="font-mono text-[10px] text-muted-foreground">{m.reference}</p>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary" className="text-[11px]">
                            {count}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={m.status} />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
