import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { fmtTZS, fmtDateTime } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Info, CheckCircle, Smartphone, User } from 'lucide-react'

interface LinkDetails {
  amount: string
  currency: string
  expiresAt: string
  status: string
}

interface RecipientDetails {
  amount: string
  currency: string
  phoneNumber: string
  payoutMethod: string
  beneficiaryName: string | null
  operator: string
  confirmed: boolean
}

export default function PayoutLinkView() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [details, setDetails] = useState<LinkDetails | null>(null)
  const [recipient, setRecipient] = useState<RecipientDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [phone, setPhone] = useState('255')
  const [method, setMethod] = useState('M-PESA')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) return
    api
      .getPublic<LinkDetails>(`/payout-links/${token}`)
      .then((res) => setDetails(res))
      .catch((err) => setError(err.message || 'Failed to load payout link'))
      .finally(() => setLoading(false))
  }, [token])

  async function handlePreview() {
    if (!token) return
    if (!/^255[67]\d{8}$/.test(phone)) {
      toast.error('Please enter a valid Tanzanian mobile number')
      return
    }

    try {
      const res = await api.postPublic<RecipientDetails>(`/payout-links/${token}/recipient`, {
        phoneNumber: phone,
        payoutMethod: method,
      })
      setRecipient(res)
      setError(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to verify recipient')
    }
  }

  async function handleConfirm() {
    if (!token || !recipient) return
    setSubmitting(true)
    try {
      const res = await api.postPublic(`/payout-links/${token}/confirm`, {
        phoneNumber: recipient.phoneNumber,
        payoutMethod: recipient.payoutMethod,
      })
      toast.success('Payout completed successfully!')
      navigate('/dashboard') // Redirect to dashboard or success page
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to confirm payout')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto max-w-md py-12">
        <Card>
          <CardHeader>
            <CardTitle>Payout Link</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container mx-auto max-w-md py-12">
        <Card>
          <CardHeader>
            <CardTitle>Payout Link Error</CardTitle>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <Info className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!details) return null

  return (
    <div className="container mx-auto max-w-md py-12">
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600">
            <CheckCircle className="h-6 w-6" />
          </div>
          <CardTitle>You've received a payment</CardTitle>
          <CardDescription>
            You're receiving <span className="font-semibold">{fmtTZS(details.amount)}</span> to your mobile money account
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!recipient ? (
            <>
              <div className="space-y-2 rounded-lg border p-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Amount:</span>
                  <span className="font-semibold">{fmtTZS(details.amount)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Expires:</span>
                  <span>{fmtDateTime(details.expiresAt)}</span>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Your mobile number</Label>
                  <Input
                    id="phone"
                    inputMode="tel"
                    placeholder="255712345678"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    maxLength={12}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Receive via</Label>
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="M-PESA">M-PESA</SelectItem>
                      <SelectItem value="AIRTEL-MONEY">AIRTEL MONEY</SelectItem>
                      <SelectItem value="TIGO-PESA">TIGO PESA</SelectItem>
                      <SelectItem value="HALOPESA">HALOPESA</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button className="w-full" onClick={handlePreview}>
                  <Smartphone className="mr-2 h-4 w-4" />
                  Preview Payment
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-6">
              <div className="space-y-2 rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm">
                  <Smartphone className="h-4 w-4 text-muted-foreground" />
                  <span>{recipient.phoneNumber}</span>
                </div>
                {recipient.beneficiaryName ? (
                  <div className="flex items-center gap-2 text-sm">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span>{recipient.beneficiaryName}</span>
                  </div>
                ) : null}
                <div className="mt-2 flex justify-between border-t pt-2 text-sm">
                  <span>Amount:</span>
                  <span className="font-semibold">{fmtTZS(recipient.amount)}</span>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <Button onClick={handleConfirm} disabled={submitting}>
                  {submitting ? 'Processing...' : 'Confirm and Receive Payment'}
                </Button>
                <Button variant="outline" onClick={() => setRecipient(null)}>
                  Change details
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}