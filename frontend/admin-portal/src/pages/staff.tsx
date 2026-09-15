import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Loader2, UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { fmtDate, fmtDateTime } from '@/lib/format'
import type { StaffUser } from '@/lib/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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

export default function StaffPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const [rows, setRows] = useState<StaffUser[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getAuthed<{ data: StaffUser[] }>('/admin/users')
      setRows(res.data ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load staff')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Staff</h1>
          <p className="text-sm text-muted-foreground">Platform administrators, servicemen and portal users</p>
        </div>
        {isAdmin ? (
          <Button onClick={() => setOpen(true)}>
            <UserPlus className="h-4 w-4" /> New staff
          </Button>
        ) : null}
      </div>

      <Card className="animate-fade-in">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" /> Directory
          </CardTitle>
          <CardDescription>
            ADMIN can write and manage the platform. SERVICEMAN is strictly read-only. USER accounts sign in to the
            Client Portal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-xs">{s.email}</TableCell>
                    <TableCell>
                      <Badge variant={s.role === 'ADMIN' ? 'default' : s.role === 'SERVICEMAN' ? 'info' : 'secondary'}>
                        {s.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {s.isActive ? <Badge variant="success">active</Badge> : <Badge variant="danger">disabled</Badge>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{fmtDate(s.createdAt)}</TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                      No staff found
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {isAdmin ? <CreateStaffDialog open={open} onOpenChange={setOpen} onCreated={() => void load()} /> : null}
    </div>
  )
}

function CreateStaffDialog({
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
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'ADMIN' | 'SERVICEMAN' | 'USER'>('SERVICEMAN')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (name.trim().length < 2) {
      toast.error('Name is required')
      return
    }
    if (password.length < 10 || !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      toast.error('Password needs 10+ chars with upper, lower and digits')
      return
    }
    setBusy(true)
    try {
      await api.postAuthed('/admin/users', {
        name: name.trim(),
        email: email.trim(),
        password,
        role,
      })
      toast.success(`${role} account created`)
      onOpenChange(false)
      setName('')
      setEmail('')
      setPassword('')
      onCreated()
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message)
      else toast.error('Failed to create staff')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create staff account</DialogTitle>
          <DialogDescription>
            Password policy: minimum 10 characters with upper-case, lower-case and digits.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="st-name">Full name *</Label>
            <Input id="st-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st-email">Email *</Label>
            <Input id="st-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st-pass">Temporary password *</Label>
            <Input
              id="st-pass"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={128}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN">ADMIN — full write access</SelectItem>
                <SelectItem value="SERVICEMAN">SERVICEMAN — read-only</SelectItem>
                <SelectItem value="USER">USER — client portal</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export { fmtDateTime }
