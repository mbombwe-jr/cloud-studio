import { useCallback, useEffect, useState } from 'react'
import { Loader2, Route as RouteIcon, Search } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { fmtDateTime } from '@/lib/format'
import type { Paged } from '@/lib/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
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

interface TraceItem {
  id: string
  traceId: string
  component?: string
  status?: string
  startedAt?: string
  endedAt?: string | null
  durationMs?: number | null
  reference?: string | null
  attributes?: unknown
  spans?: unknown
}

export default function TracesPage() {
  const [rows, setRows] = useState<TraceItem[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [traceId, setTraceId] = useState('')
  const [reference, setReference] = useState('')
  const [detail, setDetail] = useState<TraceItem | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getAuthed<Paged<TraceItem>>('/admin/traces', {
        page,
        limit: 20,
        ...(traceId.trim() ? { traceId: traceId.trim() } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      })
      setRows(res.data)
      setTotalPages(res.meta?.pagination?.totalPages ?? 1)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load traces')
    } finally {
      setLoading(false)
    }
  }, [page, traceId, reference])

  useEffect(() => {
    const t = setTimeout(() => void load(), traceId || reference ? 350 : 0)
    return () => clearTimeout(t)
  }, [load, traceId, reference])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Traces</h1>
        <p className="text-sm text-muted-foreground">Distributed execution traces captured by the iii engine</p>
      </div>

      <Card className="animate-fade-in">
        <CardHeader className="flex-row flex-wrap items-end justify-between gap-3 space-y-0">
          <div className="space-y-1">
            <Label htmlFor="tr-id" className="text-xs text-muted-foreground">
              Trace ID
            </Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="tr-id"
                value={traceId}
                onChange={(e) => {
                  setPage(1)
                  setTraceId(e.target.value)
                }}
                placeholder="4bf92f35…"
                className="w-64 pl-8 font-mono text-xs"
                maxLength={80}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tr-ref" className="text-xs text-muted-foreground">
              Business reference
            </Label>
            <Input
              id="tr-ref"
              value={reference}
              onChange={(e) => {
                setPage(1)
                setReference(e.target.value)
              }}
              placeholder="COL-…"
              className="w-56 font-mono text-xs"
              maxLength={40}
            />
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
              <RouteIcon className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-2 text-sm text-muted-foreground">No traces match your filters.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Trace ID</TableHead>
                  <TableHead>Component</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id} className="cursor-pointer" onClick={() => setDetail(t)}>
                    <TableCell className="whitespace-nowrap text-xs">{t.startedAt ? fmtDateTime(t.startedAt) : '—'}</TableCell>
                    <TableCell className="font-mono text-[11px]">{t.traceId.slice(0, 18)}…</TableCell>
                    <TableCell className="text-xs">{t.component ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={t.status === 'ERROR' ? 'danger' : t.status === 'OK' ? 'success' : 'muted'}>
                        {t.status ?? 'UNKNOWN'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {t.durationMs !== null && t.durationMs !== undefined ? `${t.durationMs} ms` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={detail !== null} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{detail?.traceId}</DialogTitle>
            <DialogDescription>Full trace snapshot (span data preserved)</DialogDescription>
          </DialogHeader>
          <pre className="max-h-[55vh] overflow-auto rounded-md bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-100">
            {JSON.stringify(detail, null, 2)}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export { Loader2 }
