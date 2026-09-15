import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, Loader2, Eye, EyeOff, ShieldCheck, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { api, tokens, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { AccountProfile } from '@/lib/types'

/**
 * Connect page — the business API (wallets, SMS, collections, disbursements)
 * authenticates with a per-account API key, not the staff JWT. The key is
 * validated against GET /me and then kept in sessionStorage only.
 */
export default function ConnectPage() {
  const navigate = useNavigate()
  const [key, setKey] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const k = key.trim()
    if (k.length < 32) {
      setError('API keys are at least 32 characters long. Paste the full key (zs_live_…).')
      return
    }
    setBusy(true)
    // Store first so the keyed client can attach it, then validate with GET /me.
    tokens.setApiKey(k)
    try {
      const profile = await api.getKeyed<AccountProfile>('/me')
      toast.success(`Connected to ${profile.accountName}`)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      tokens.clearApiKey()
      if (err instanceof ApiError && err.status === 401) {
        setError('Key rejected: the API key is invalid, revoked, or its account is suspended.')
      } else {
        setError(err instanceof Error ? err.message : 'Connection failed. Check the network and try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg py-6">
      <Card className="animate-fade-in">
        <CardHeader>
          <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <KeyRound className="h-5 w-5" />
          </div>
          <CardTitle>Connect your account</CardTitle>
          <CardDescription>
            Business data (wallets, payments, SMS) is protected by an account API key issued by your platform admin.
            Paste it once to unlock this session.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {error ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="apikey">Account API key</Label>
              <div className="relative">
                <Input
                  id="apikey"
                  type={show ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="zs_live_xxxxxxxxxxxxxxxx"
                  className="pr-10 font-mono"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  disabled={busy}
                  maxLength={200}
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                  aria-label={show ? 'Hide key' : 'Show key'}
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {busy ? 'Validating…' : 'Connect account'}
            </Button>
          </form>

          <Alert className="mt-5" variant="info">
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>How this key is protected</AlertTitle>
            <AlertDescription>
              It is held only in this browser tab's session storage, sent exclusively to the Zoo API over your
              private network, never written to disk, and erased when you close the tab or sign out.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  )
}
