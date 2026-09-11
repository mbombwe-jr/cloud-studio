# ZooStudios Plus — Bruno API Collection

Complete Bruno (OpenCollection) request collection covering the whole
ZooStudios backend: health, auth, accounts, permissions, billing, wallets,
collections (USSD push), disbursements, SMS, webhooks and admin insights.

## Import

Bruno >= v2.x -> "Open Collection" -> select this folder (the one containing
`opencollection.yml`).

## Environment

`environments/development.yml` ships with the default `baseUrl`:
`http://localhost:3000`.

## Two authentication schemes

| Scheme   | Header                      | Variable         | Used by |
|----------|-----------------------------|------------------|---------|
| Staff JWT| `Authorization: Bearer ...` | `{{accessToken}}`| `/auth/**`, `/admin/**` |
| API key  | `X-API-Key: ...`            | `{{apiKey}}`     | `/me`, `/collections/**`, `/disbursements/**`, `/sms/**`, `/wallets/**`, `/me/webhooks/**` |

## Suggested run order

1. `health` — service is up
2. `auth/login` — copy `accessToken` from the response into the environment
3. `accounts/create-account` — copy the account public id into `{{accountId}}`
4. `accounts/issue-api-key` — copy the one-time key into `{{apiKey}}`
5. `accounts/set-permissions` — grant COLLECTION / DISBURSEMENT / SMS
6. `billing/create-plan` + `billing/assign-plan` (or leave PAY_AS_YOU_GO)
7. `admin-wallets/deposit` — fund the account COLLECTION/DISBURSEMENT wallets
8. `account-api/collections/ussd-push-initiate` — copy the 20-char reference
9. `account-api/disbursements/*` — mobile money / bank / batch payouts
   (the backend automatically appends `"currency": "TZS"` to the ClickPesa
   bank payout payload)
10. `account-api/sms/send` — SMS with automatic cost calculation
11. `admin-insights/*` — overview, computations, audit logs, analytics, traces

Note: bills are assigned manually by admins; the platform never auto-suspends
an account because of a bill.
