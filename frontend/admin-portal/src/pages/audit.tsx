import { useCallback, useEffect, useState } from 'react'
import { Loader2, ScrollText } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { fmtDateTime } from '@/lib/format'
import type { AuditLog, Paged } from '@/lib/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

export default function AuditPage() {
  const [rows, setRows] = useState<AuditLog[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState('')
  const [actorType, setActorType] = useState('ALL')
  const [detail, setDetail] = useState<AuditLog | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getAuthed<Paged<AuditLog>>('/admin/audit-logs', {
        page,
        limit: 20,
        ...(action.trim() ? { action: action.trim() } : {}),
        ...(actorType !== 'ALL' ? { actorType } : {}),
      })
      setRows(res.data)
      setTotalPages(res.meta?.pagination?.totalPages ?? 1)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load audit logs')
    } finally {
      setLoading(false)
    }
  }, [page, action, actorType])

  useEffect(() => {
    const t = setTimeout(() => void load(), action ? 350 : 0)
    return () => clearTimeout(t)
  }, [load, action])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Audit logs</h1>
        <p className="text-sm text-muted-foreground">Every privileged action, who did it and from where</p>
      </div>

      <Card className="animate-fade-in">
        <CardHeader className="flex-row flex-wrap items-end justify-between gap-3 space-y-0">
          <div className="space-y-1">
            <Label htmlFor="au-action" className="text-xs text-muted-foreground">
              Action filter (e.g. api_key.created)
            </Label>
            <Input
              id="au-action"
              value={action}
              onChange={(e) => {
                setPage(1)
                setAction(e.target.value)
              }}
              placeholder="account."
              className="w-56 font-mono text-xs"
              maxLength={60}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Actor type</Label>
            <Select
              value={actorType}
              onValueChange={(v) => {
                setActorType(v)
                setPage(1)
              }}
            >
              <SelectTrigger className="h-9 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All actors</SelectItem>
                <SelectItem value="ADMIN">ADMIN</SelectItem>
                <SelectItem value="API_KEY">API_KEY</SelectItem>
                <SelectItem value="SERVICEMAN">SERVICEMAN</SelectItem>
                <SelectItem value="SYSTEM">SYSTEM</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
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
              <ScrollText className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-2 text-sm text-muted-foreground">No audit entries match.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((l) => (
                  <TableRow key={l.id} className="cursor-pointer" onClick={() => setDetail(l)}>
                    <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(l.createdAt)}</TableCell>
                    <TableCell className="font-mono text-xs font-medium">{l.action}</TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="outline" className="mr-1.5 text-[10px]">
                        {l.actorType}
                      </Badge>
                      {l.actorName ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {l.entity ? `${l.entity}${l.entityId ? ` · ${l.entityId.slice(0, 10)}` : ''}` : '—'}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">{l.ip ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={detail !== null} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-base">{detail?.action}</DialogTitle>
            <DialogDescription>Audit entry detail</DialogDescription>
          </DialogHeader>
          {detail ? (
            <div className="space-y-2 text-sm">
              <Row label="Time" value={fmtDateTime(detail.createdAt)} />
              <Row label="Actor" value={`${detail.actorType}${detail.actorName ? ` · ${detail.actorName}` : ''}`} />
              <Row label="Entity" value={detail.entity ?? '—'} />
              <Row label="Entity ID" value={<span className="font-mono text-xs">{detail.entityId ?? '—'}</span>} />
              <Row label="Account" value={<span className="font-mono text-xs">{detail.accountId ?? '—'}</span>} />
              <Row label="IP" value={<span className="font-mono text-xs">{detail.ip ?? '—'}</span>} />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate text-right">{value ?? '—'}</span>
    </div>
  )
}

export { Loader2 }
