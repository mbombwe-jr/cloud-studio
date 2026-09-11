#!/usr/bin/env bash
# Zoostudios backend — full end-to-end API smoke test (mock providers mode)
# Usage: bash scripts/smoke.sh [BASE_URL]  (default http://127.0.0.1:3010)
set -u
BASE="${1:-http://127.0.0.1:3010}"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL: $1  ->  $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected=[$3] got=[$2]"; fi; }
checkn(){ if [ -n "$2" ] && [ "$2" != "None" ] && [ "$2" != "null" ]; then ok "$1"; else bad "$1" "empty"; fi; }

jg(){ printf '%s' "$1" | python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$2" 2>/dev/null; }

echo "== 1. Health =="
H=$(curl -s $BASE/health)
check "health status ok" "$(jg "$H" "d['data']['status']")" "ok"

echo "== 2. Admin login =="
L=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@zoostudios.internal","password":"ChangeMe!2025"}')
TOKEN=$(jg "$L" "d['data']['accessToken']")
AUTH="Authorization: Bearer $TOKEN"
checkn "admin login returns JWT (${#TOKEN} chars)" "$TOKEN"

echo "== 3. Create account (admin, on behalf of owner) =="
A=$(curl -s -X POST $BASE/admin/accounts -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"accountName":"Smoke Test Ltd","contactEmail":"owner@smoke.tz","contactPhone":"255712345678"}')
ACC_ID=$(jg "$A" "d['data']['account']['accountId']")
SRC=$(jg "$A" "d['data']['account']['sourceCode']")
UUID=$(jg "$A" "d['data']['account']['id']")
APIKEY=$(jg "$A" "d['data']['apiKey']['apiKey']")
check "accountId format ACC-XXXXXXXX" "$([ "${ACC_ID#ACC-}" != "$ACC_ID" ] && echo yes)" "yes"
check "5-char unique sourceCode" "${#SRC}" "5"
check "api key >= 32 chars" "$([ ${#APIKEY} -ge 32 ] && echo yes)" "yes"
check "both wallets provisioned" "$(jg "$A" "len(d['data']['account']['wallets'])")" "2"
check "permissions default denied" "$(jg "$A" "sum(1 for p in d['data']['account']['permissions'] if p['granted'])")" "0"

echo "== 4. API-key auth resolves account (/me) =="
M=$(curl -s $BASE/me -H "X-API-Key: $APIKEY")
check "/me resolves account" "$(jg "$M" "d['data']['accountId']")" "$ACC_ID"

echo "== 5. Collection blocked before permission grant =="
C0=$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/collections/ussd-push -H "X-API-Key: $APIKEY" \
  -H 'Content-Type: application/json' -d '{"amount":"1000","phoneNumber":"255712345678"}')
check "collection denied (403)" "$C0" "403"

echo "== 6. Grant all three services =="
G=$(curl -s -X PUT $BASE/admin/accounts/$UUID/permissions -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"permissions":[{"service":"COLLECTION","granted":true},{"service":"DISBURSEMENT","granted":true},{"service":"SMS","granted":true}]}')
check "3 grants stored" "$(jg "$G" "sum(1 for p in d['data'] if p['granted'])")" "3"

echo "== 7. Admin deposits into both wallets =="
D1=$(curl -s -X POST $BASE/admin/accounts/$UUID/wallets/COLLECTION/deposit -H "$AUTH" -H 'Content-Type: application/json' -d '{"amount":"50000","reason":"float top-up"}')
D2=$(curl -s -X POST $BASE/admin/accounts/$UUID/wallets/DISBURSEMENT/deposit -H "$AUTH" -H 'Content-Type: application/json' -d '{"amount":"200000","reason":"payout float"}')
check "collection wallet balanceAfter=50000" "$(jg "$D1" "d['data']['balanceAfter']")" "50000"
check "disbursement wallet balanceAfter=200000" "$(jg "$D2" "d['data']['balanceAfter']")" "200000"

echo "== 8. USSD push preview (fetch sender details) =="
P=$(curl -s -X POST $BASE/collections/ussd-push/preview -H "X-API-Key: $APIKEY" -H 'Content-Type: application/json' \
  -d '{"amount":"15000","phoneNumber":"255712345678","fetchSenderDetails":true}')
check "preview returns sender name" "$(jg "$P" "d['data']['sender']['accountName']")" "MOCK SENDER"
check "preview returns active methods" "$(jg "$P" "len(d['data']['activeMethods'])>0")" "True"

echo "== 9. Initiate USSD push collection =="
C=$(curl -s -X POST $BASE/collections/ussd-push -H "X-API-Key: $APIKEY" -H 'Content-Type: application/json' \
  -d '{"amount":"15000","phoneNumber":"255712345678","reference":"ORDER1"}')
REF=$(jg "$C" "d['data']['reference']")
check "20-char reference" "${#REF}" "20"
check "reference starts with account prefix" "$([ "${REF:0:5}" = "$SRC" ] && echo yes)" "yes"
check "client ref embedded after prefix" "${REF:5:6}" "ORDER1"
check "status PROCESSING" "$(jg "$C" "d['data']['status']")" "PROCESSING"

echo "== 10. ClickPesa webhook: payment success -> wallet credited =="
W=$(curl -s -X POST $BASE/webhooks/clickpesa -H 'Content-Type: application/json' \
  -d "{\"event\":\"payment.successful\",\"data\":{\"orderReference\":\"$REF\",\"status\":\"SUCCESSFUL\",\"collectedAmount\":15000,\"channel\":\"USSD\"}}")
check "webhook accepted" "$(jg "$W" "d['data']['received']")" "True"
sleep 1.5
WL=$(curl -s $BASE/wallets -H "X-API-Key: $APIKEY")
CBAL=$(jg "$WL" "[w['balance'] for w in d['data'] if w['type']=='COLLECTION'][0]")
check "collection wallet 50000+15000=65000" "$CBAL" "65000"
CT=$(curl -s "$BASE/wallets/COLLECTION/transactions" -H "X-API-Key: $APIKEY")
check "ledger shows COLLECTION_CREDIT" "$(jg "$CT" "d['data'][0]['type']")" "COLLECTION_CREDIT"

echo "== 11. Duplicate webhook is idempotent (no double credit) =="
curl -s -X POST $BASE/webhooks/clickpesa -H 'Content-Type: application/json' \
  -d "{\"event\":\"payment.successful\",\"data\":{\"orderReference\":\"$REF\",\"status\":\"SUCCESSFUL\",\"collectedAmount\":15000}}" >/dev/null
sleep 1.5
WL2=$(curl -s $BASE/wallets -H "X-API-Key: $APIKEY")
check "balance still 65000" "$(jg "$WL2" "[w['balance'] for w in d['data'] if w['type']=='COLLECTION'][0]")" "65000"

echo "== 12. Bank payout (payload incl. currency:TZS correction) =="
B=$(curl -s -X POST $BASE/disbursements/bank -H "X-API-Key: $APIKEY" -H 'Content-Type: application/json' \
  -d '{"amount":"5000","accountNumber":"0676544740","accountName":"DEOGRATIUS DENIS MBOMBWE","bic":"ACTZTZTZ"}')
BREF=$(jg "$B" "d['data']['reference']")
checkn "payout created with reference" "$BREF"
check "payout accepted (status set)" "$(jg "$B" "d['data']['status'] in ('PENDING','PROCESSING','SUCCESS')")" "True"

echo "== 13. Payout webhook success -> wallet debited =="
curl -s -X POST $BASE/webhooks/clickpesa -H 'Content-Type: application/json' \
  -d "{\"event\":\"payout.successful\",\"data\":{\"orderReference\":\"$BREF\",\"status\":\"SUCCESSFUL\"}}" >/dev/null
sleep 1.5
WL3=$(curl -s $BASE/wallets -H "X-API-Key: $APIKEY")
check "disbursement wallet 200000-5000=195000" "$(jg "$WL3" "[w['balance'] for w in d['data'] if w['type']=='DISBURSEMENT'][0]")" "195000"

echo "== 14. Insufficient funds protection =="
OV=$(curl -s -X POST $BASE/disbursements/mobile-money -H "X-API-Key: $APIKEY" \
  -H 'Content-Type: application/json' -d '{"amount":"99999999","phoneNumber":"255712345678"}')
check "overdraw rejected INSUFFICIENT_FUNDS" "$(jg "$OV" "d['error']['code']")" "INSUFFICIENT_FUNDS"

echo "== 15. Batch disbursement =="
BA=$(curl -s -X POST $BASE/disbursements/batches -H "X-API-Key: $APIKEY" -H 'Content-Type: application/json' \
  -d '{"name":"August salaries","items":[{"channel":"MOBILE_MONEY","amount":"2000","phoneNumber":"255712345678"},{"channel":"MOBILE_MONEY","amount":"3000","phoneNumber":"255765432109"}]}')
check "batch totalCount=2" "$(jg "$BA" "d['data']['totalCount']")" "2"

echo "== 16. SMS send via shared sender + history =="
S=$(curl -s -X POST $BASE/sms/send -H "X-API-Key: $APIKEY" -H 'Content-Type: application/json' \
  -d '{"message":"Hello from Zoostudios","recipients":["255712345678","0765432109"]}')
SREF=$(jg "$S" "d['data']['reference']")
check "sms accepted via shared sender ZOOINFO" "$(jg "$S" "d['data']['senderName']")" "ZOOINFO"
check "recipients normalized (2)" "$(jg "$S" "d['data']['recipientCount']")" "2"
sleep 2
S2=$(curl -s "$BASE/sms/$SREF" -H "X-API-Key: $APIKEY")
check "sms dispatched SENT" "$(jg "$S2" "d['data']['status']")" "SENT"
check "cost computed (rate x segments x recipients)" "$(jg "$S2" "float(d['data']['cost'])>0")" "True"

echo "== 17. Admin computation review (anti-fraud ledger check) =="
R=$(curl -s "$BASE/admin/accounts/$UUID/computations?preset=month" -H "$AUTH")
check "month preset: ledger balanced" "$(jg "$R" "all(w['ledgerConsistent'] for w in d['data']['wallets'])")" "True"
R2=$(curl -s "$BASE/admin/accounts/$UUID/computations?preset=day" -H "$AUTH")
check "day preset: ledger balanced" "$(jg "$R2" "all(w['ledgerConsistent'] for w in d['data']['wallets'])")" "True"
TODAY=$(date +%F); R3=$(curl -s "$BASE/admin/accounts/$UUID/computations?preset=custom&from=$TODAY&to=$TODAY" -H "$AUTH")
check "custom range: ledger balanced" "$(jg "$R3" "all(w['ledgerConsistent'] for w in d['data']['wallets'])")" "True"
check "review shows collection totals" "$(jg "$R" "d['data']['collection']['totalCount']>=1")" "True"

echo "== 18. Serviceman account + read-only enforcement =="
curl -s -X POST $BASE/admin/users -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"email":"watcher@zoostudios.internal","password":"WatchOnly!2025","name":"Smoke Watcher","role":"SERVICEMAN"}' >/dev/null
STOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"watcher@zoostudios.internal","password":"WatchOnly!2025"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['accessToken'])")
checkn "serviceman login ok" "$STOKEN"
RO=$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/admin/accounts -H "Authorization: Bearer $STOKEN" -H 'Content-Type: application/json' -d '{"accountName":"Hack"}')
check "serviceman write blocked (403)" "$RO" "403"
RV=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/admin/accounts/$UUID/overview" -H "Authorization: Bearer $STOKEN")
check "serviceman read allowed (200)" "$RV" "200"
TR=$(curl -s "$BASE/admin/traces?reference=$REF" -H "Authorization: Bearer $STOKEN")
TCOUNT=$(jg "$TR" "len(d['data']['items'] if isinstance(d['data'],dict) and 'items' in d['data'] else d['data'])")
check "trace data preserved for transaction" "$([ "${TCOUNT:-0}" -ge 1 ] && echo yes)" "yes"

echo "== 19. Suspension is manual (admin-only), blocks service calls =="
SU=$(curl -s -X POST $BASE/admin/accounts/$UUID/suspend -H "$AUTH" -H 'Content-Type: application/json' -d '{"suspendReason":"smoke test suspension"}')
check "suspend works" "$(jg "$SU" "d['data']['status']")" "SUSPENDED"
C2=$(curl -s -X POST $BASE/collections/ussd-push -H "X-API-Key: $APIKEY" -H 'Content-Type: application/json' -d '{"amount":"1000","phoneNumber":"255712345678"}')
check "suspended account blocked" "$(jg "$C2" "d['error']['code']")" "ACCOUNT_SUSPENDED"
curl -s -X POST $BASE/admin/accounts/$UUID/activate -H "$AUTH" -H 'Content-Type: application/json' -d '{}' >/dev/null

echo ""
echo "======================================"
echo "SMOKE RESULT: $PASS passed, $FAIL failed"
echo "======================================"
[ $FAIL -eq 0 ]
