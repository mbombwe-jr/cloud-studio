import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, Building2, CircleDollarSign, MessageSquare, Users } from 'lucide-react'
import { api } from '@/lib/api'
import { fmtNumber } from '@/lib/format'
import { StatCard } from '@/components/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

interface AnalyticsSummary {
  from: string
  to: string
  summary: { event: string; count: number; totalValue: number | null }[]
}

export default function DashboardPage() {
  const [data, setData] = useState<AnalyticsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .getAuthed<AnalyticsSummary>('/admin/analytics/summary')
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Failed to load analytics'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const rows = data?.summary ?? []
  const totalEvents = rows.reduce((s, r) => s + r.count, 0)
  const paymentEvents = rows.filter((r) => /payment|payout|collection|disburse/i.test(r.event))
  const paymentValue = paymentEvents.reduce((s, r) => s + (r.totalValue ?? 0), 0)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Platform activity for the last 30 days
          {data?.from ? ` (${new Date(data.from).toLocaleDateString()} → ${new Date(data.to).toLocaleDateString()})` : ''}
        </p>
      </div>

      {error ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Tracked events" value={fmtNumber(totalEvents)} icon={Activity} loading={loading} />
          <StatCard
            title="Payment volume"
            value={fmtNumber(paymentValue)}
            hint="Sum of tracked payment values"
            icon={CircleDollarSign}
            loading={loading}
            accent="success"
          />
          <StatCard
            title="Payment events"
            value={fmtNumber(paymentEvents.reduce((s, r) => s + r.count, 0))}
            icon={MessageSquare}
            loading={loading}
            accent="info"
          />
          <StatCard title="Distinct events" value={fmtNumber(rows.length)} icon={Users} loading={loading} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="animate-fade-in lg:col-span-2">
          <CardHeader>
            <CardTitle>Event breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No analytics events in this window yet.
              </p>
            ) : (
              <div className="divide-y rounded-md border">
                {rows.map((r) => (
                  <div key={r.event} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="font-mono text-xs">{r.event}</span>
                    <span className="flex items-center gap-4">
                      <span className="text-xs text-muted-foreground">{fmtNumber(r.count)}×</span>
                      {r.totalValue !== null ? (
                        <span className="font-mono text-xs font-semibold">{fmtNumber(r.totalValue)}</span>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="animate-fade-in">
          <CardHeader>
            <CardTitle>Manage</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2.5">
            <Button asChild variant="outline" className="justify-start">
              <Link to="/accounts">
                <Building2 className="h-4 w-4" /> Open accounts
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link to="/staff">
                <Users className="h-4 w-4" /> Manage staff
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link to="/audit">
                <Activity className="h-4 w-4" /> Review audit logs
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link to="/traces">
                <Activity className="h-4 w-4" /> Inspect traces
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
