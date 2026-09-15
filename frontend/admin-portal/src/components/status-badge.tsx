import { Badge } from '@/components/ui/badge'

const MAP: Record<string, { variant: 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'default'; label?: string }> = {
  // generic lifecycle
  ACTIVE: { variant: 'success' },
  SUSPENDED: { variant: 'danger' },
  INACTIVE: { variant: 'muted' },
  PENDING: { variant: 'warning' },
  PROCESSING: { variant: 'info' },
  QUEUED: { variant: 'muted' },
  SENT: { variant: 'info' },
  DELIVERED: { variant: 'success' },
  FAILED: { variant: 'danger' },
  CANCELLED: { variant: 'muted' },
  EXPIRED: { variant: 'danger' },
  // payments
  SUCCESS: { variant: 'success' },
  SUCCEEDED: { variant: 'success' },
  COMPLETED: { variant: 'success' },
  APPROVED: { variant: 'success' },
  PARTIALLY_COMPLETED: { variant: 'warning' },
  SUBMITTED: { variant: 'info' },
  // wallets
  FROZEN: { variant: 'danger' },
  // billing
  PAID: { variant: 'success' },
  UNPAID: { variant: 'warning' },
  OPEN: { variant: 'info' },
  VOID: { variant: 'muted' },
  DRAFT: { variant: 'muted' },
  // misc
  GRANTED: { variant: 'success' },
  DENIED: { variant: 'danger' },
  ENABLED: { variant: 'success' },
  DISABLED: { variant: 'muted' },
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-muted-foreground">—</span>
  const entry = MAP[status.toUpperCase()]
  return (
    <Badge variant={entry?.variant ?? 'muted'} className="whitespace-nowrap">
      {entry?.label ?? status.replaceAll('_', ' ')}
    </Badge>
  )
}
