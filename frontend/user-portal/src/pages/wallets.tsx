import { useCallback, useEffect, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, Landmark, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api'
import { fmtTZS, fmtDateTime } from '@/lib/format'
import type { Wallet, WalletTxsResponse, Deposit, WalletTransfer, SettlementPayout, SettlementAccount } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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

type WalletType = 'COLLECTION' | 'DISBURSEMENT'

const FEE_NOTE = 'Fees: 5% for transactions below TZS 3,000 and 2% from TZS 3,000 (per your account fee schedule; transfers 2%).'

export default function WalletsPage() {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState<WalletType>('COLLECTION')
  const [txs, setTxs] = useState<WalletTxsResponse | null>(null)
  const [txLoading, setTxLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [dialog, setDialog] = useState<'deposit' | 'transfer' | 'withdraw' | null>(null)
  const [settlements, setSettlements] = useState<SettlementAccount[]>([])

  const loadWallets = useCallback(async () => {
    try {
      const list = await api.getKeyed<{ data: Wallet[] }>('/wallets')
      setWallets(list.data ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load wallets')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadWallets()
  }, [loadWallets])

  // settlement accounts (used by the withdraw dialog)
  useEffect(() => {
    api
      .getKeyed<{ data: SettlementAccount[] }>('/wallets/settlement-accounts')
      .then((r) => setSettlements(r.data ?? []))
      .catch(() => setSettlements([]))
  }, [dialog])

  useEffect(() => {
    let alive = true
    setTxLoading(true)
    api
      .getKeyed<WalletTxsResponse>(`/wallets/${active}/transactions`, { page, limit: 15 })
      .then((r) => alive && setTxs(r))
      .catch(() => alive && setTxs(null))
      .finally(() => alive && setTxLoading(false))
    return () => {
      alive = false
    }
  }, [active, page])

  const refresh = () => {
    setPage(1)
    void loadWallets()
    setTxLoading(true)
  }

  const wallet = txs?.wallet ?? wallets.find((w) => w.type === active)
  const totalPages = txs?.meta?.pagination?.totalPages ?? 1

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Wallets</h1>
          <p className="text-sm text-muted-foreground">Balances, deposits, transfers and settlements</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setDialog('deposit')}>
            <ArrowDownToLine className="h-4 w-4" /> Deposit
          </Button>
          <Button variant="outline" onClick={() => setDialog('transfer')}>
            <ArrowLeftRight className="h-4 w-4" /> Transfer
          </Button>
          <Button variant="outline" onClick={() => setDialog('withdraw')}>
            <Landmark className="h-4 w-4" /> Withdraw
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {loading
          ? [1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-lg" />)
          : wallets.map((w) => (
              <Card
                key={w.id}
                className={`cursor-pointer transition-shadow hover:shadow-md ${active === w.type ? 'ring-2 ring-ring' : ''}`}
                onClick={() => {
                  setActive(w.type)
                  setPage(1)
                }}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium text-muted-foreground">{w.type} wallet</CardTitle>
                    <Badge variant={w.status === 'ACTIVE' ? 'success' : 'danger'}>{w.status}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold tracking-tight">{fmtTZS(w.balance)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {w.currency}
                    {w.type === 'DISBURSEMENT' ? ' — funded by deposits & transfers' : ' — funded by collections'}
                  </p>
                </CardContent>
              </Card>
            ))}
      </div>

      <Card className="animate-fade-in">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>{active} transactions</CardTitle>
            <CardDescription>Ledger history with every credit and debit</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={refresh} aria-label="refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {txLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : txs && txs.items.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Reference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {txs.items.map((t) => {
                  const amt = Number(t.amount)
                  const credit = amt > 0
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(t.createdAt)}</TableCell>
                      <TableCell className="text-xs font-medium">{t.type.replaceAll('_', ' ')}</TableCell>
                      <TableCell className={`text-right font-mono text-xs font-semibold ${credit ? 'text-emerald-600' : 'text-red-600'}`}>
                        {credit ? '+' : ''}
                        {fmtTZS(t.amount).replace('TZS ', '')}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{Number(t.balanceAfter).toLocaleString()}</TableCell>
                      <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">{t.description ?? '—'}</TableCell>
                      <TableCell className="font-mono text-[11px]">{t.reference ?? '—'}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">No transactions yet for this wallet.</p>
          )}
        </CardContent>
      </Card>

      <DepositDialog open={dialog === 'deposit'} onOpenChange={(v) => setDialog(v ? 'deposit' : null)} onDone={refresh} />
      <TransferDialog open={dialog === 'transfer'} onOpenChange={(v) => setDialog(v ? 'transfer' : null)} onDone={refresh} />
      <WithdrawDialog
        open={dialog === 'withdraw'}
        onOpenChange={(v) => setDialog(v ? 'withdraw' : null)}
        onDone={refresh}
        settlements={settlements}
      />
    </div>
  )
}

function amountError(amt: string): string | null {
  if (!/^\d+(\.\d{1,2})?$/.test(amt) || Number(amt) <= 0) return 'Enter a valid positive amount, e.g. 15000'
  return null
}

/* --------------------------- Deposit (USSD push) --------------------------- */

function DepositDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [amount, setAmount] = useState('')
  const [phone, setPhone] = useState('')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Deposit | null>(null)

  async function submit() {
    const amt = amount.trim()
    const err = amountError(amt)
    if (err) return toast.error(err)
    if (!/^(\+?255|0)?[67]\d{8}$/.test(phone.trim())) {
      return toast.error('Enter a valid Tanzanian mobile number, e.g. 0712345678')
    }
    setBusy(true)
    try {
      const res = await api.postKeyed<Deposit & { data?: Deposit }>('/wallets/deposits', {
        amount: amt,
        phoneNumber: phone.trim(),
        reference: reference.trim() || undefined,
      })
      const row = (res?.data ?? res) as Deposit
      setPending(row)
      toast.success('Deposit initiated — the payer will receive a USSD push to authorise')
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Deposit failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setPending(null); setAmount(''); setPhone(''); setReference('') } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Deposit into DISBURSEMENT wallet</DialogTitle>
          <DialogDescription>
            A USSD push is sent to the payer; once authorised via ClickPesa the amount is credited to your disbursement wallet.
          </DialogDescription>
        </DialogHeader>
        {pending ? (
          <div className="space-y-3 rounded-md border p-4 text-sm">
            <p className="font-medium">Deposit pending authorisation</p>
            <p className="text-muted-foreground">Reference</p>
            <p className="font-mono text-xs">{pending.reference}</p>
            <p className="text-muted-foreground">
              {fmtTZS(pending.amount)} pushed to {pending.phoneNumber}. The balance updates automatically once ClickPesa confirms.
            </p>
            <Button variant="outline" className="w-full" onClick={() => { onOpenChange(false); setPending(null) }}>
              Close
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="dep-amount">Amount (TZS)</Label>
                <Input id="dep-amount" inputMode="decimal" placeholder="15000" value={amount} onChange={(e) => setAmount(e.target.value)} maxLength={15} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dep-phone">Payer phone number</Label>
                <Input id="dep-phone" inputMode="tel" placeholder="0712345678" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={15} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dep-ref">Reference (optional)</Label>
                <Input id="dep-ref" placeholder="TOPUP-01" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={15} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
              <Button onClick={submit} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDownToLine className="h-4 w-4" />}
                Push to payer
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ---------------------- Transfer (COLLECTION -> DISBURSEMENT) ---------------------- */

function TransferDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    const amt = amount.trim()
    const err = amountError(amt)
    if (err) return toast.error(err)
    setBusy(true)
    try {
      const res = await api.postKeyed<WalletTransfer & { data?: WalletTransfer }>('/wallets/transfers', {
        amount: amt,
        reference: reference.trim() || undefined,
      })
      const row = (res?.data ?? res) as WalletTransfer
      toast.success(`Transferred ${fmtTZS(row.amount)} (fee ${fmtTZS(row.feeAmount)}) to DISBURSEMENT`)
      onOpenChange(false)
      setAmount('')
      setReference('')
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Transfer failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer COLLECTION to DISBURSEMENT</DialogTitle>
          <DialogDescription>Instant internal move charged at your custom transfer fee (default 2%).</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tr-amount">Amount (TZS)</Label>
            <Input id="tr-amount" inputMode="decimal" placeholder="10000" value={amount} onChange={(e) => setAmount(e.target.value)} maxLength={15} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tr-ref">Reference (optional)</Label>
            <Input id="tr-ref" placeholder="FLOAT-01" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={15} />
          </div>
          <p className="text-xs text-muted-foreground">{FEE_NOTE}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}
            Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------- Withdraw (settle to settlement account) ------------------- */

function WithdrawDialog({
  open,
  onOpenChange,
  onDone,
  settlements,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onDone: () => void
  settlements: SettlementAccount[]
}) {
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const defaultSettlement = settlements.find((s) => s.isDefault && s.isActive) ?? settlements.find((s) => s.isActive)

  async function submit() {
    const amt = amount.trim()
    const err = amountError(amt)
    if (err) return toast.error(err)
    if (!defaultSettlement) {
      return toast.error('No settlement account on this account — ask the admin to add one')
    }
    setBusy(true)
    try {
      const res = await api.postKeyed<SettlementPayout & { data?: SettlementPayout }>('/wallets/withdrawals', {
        amount: amt,
        reference: reference.trim() || undefined,
      })
      const row = (res?.data ?? res) as SettlementPayout
      toast.success(`Settlement of ${fmtTZS(row.amount)} initiated (${row.channel === 'BANK' ? 'bank payout' : 'mobile payout'})`)
      onOpenChange(false)
      setAmount('')
      setReference('')
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Withdrawal failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Withdraw to settlement account</DialogTitle>
          <DialogDescription>
            Settles the specified amount from your COLLECTION wallet via the payout rail.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {defaultSettlement ? (
            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium">
                {defaultSettlement.type === 'BANK'
                  ? `${defaultSettlement.bankName} ${defaultSettlement.bankInitials ? `(${defaultSettlement.bankInitials})` : ''} · ${defaultSettlement.accountNumber}`
                  : `${defaultSettlement.method} · ${defaultSettlement.phoneNumber}`}
              </p>
              <p className="text-xs text-muted-foreground">Default settlement account</p>
            </div>
          ) : (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
              No active settlement account configured — contact the administrator.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="wd-amount">Amount (TZS)</Label>
            <Input id="wd-amount" inputMode="decimal" placeholder="20000" value={amount} onChange={(e) => setAmount(e.target.value)} maxLength={15} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wd-ref">Reference (optional)</Label>
            <Input id="wd-ref" placeholder="SETTLE-01" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={15} />
          </div>
          <p className="text-xs text-muted-foreground">{FEE_NOTE}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpFromLine className="h-4 w-4" />}
            Settle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
