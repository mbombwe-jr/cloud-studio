import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

export function StatCard({
  title,
  value,
  hint,
  icon: Icon,
  loading,
  accent,
}: {
  title: string
  value: React.ReactNode
  hint?: React.ReactNode
  icon?: LucideIcon
  loading?: boolean
  accent?: 'default' | 'success' | 'warning' | 'danger' | 'info'
}) {
  const accentClass =
    accent === 'success'
      ? 'text-emerald-600 bg-emerald-50'
      : accent === 'warning'
        ? 'text-amber-600 bg-amber-50'
        : accent === 'danger'
          ? 'text-red-600 bg-red-50'
          : accent === 'info'
            ? 'text-sky-600 bg-sky-50'
            : 'text-zinc-600 bg-zinc-100'
  return (
    <Card className="animate-fade-in">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
            {loading ? (
              <Skeleton className="mt-2 h-7 w-28" />
            ) : (
              <p className="mt-1.5 truncate text-2xl font-semibold tracking-tight">{value}</p>
            )}
            {hint ? <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p> : null}
          </div>
          {Icon ? (
            <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', accentClass)}>
              <Icon className="h-5 w-5" />
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
