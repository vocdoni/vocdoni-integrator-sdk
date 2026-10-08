#!/usr/bin/env bash
# Bootstraps a fresh saas-backend (booted via integration/docker-compose.ci.yml)
# into an integrator API key usable by integration/full-flow.itest.ts.
#
# Steps: register a user -> read the verification code out of MailHog ->
# verify -> log in -> create an organization -> mint an integrator API key
# for it. The seeded plan (integration/seed-plan.js) carries
# integratorLimits.maxManagedOrgs, which is what makes every organization
# created against it an integrator org (Subscriptions.IsIntegrator falls back
# to the org's plan when there is no per-org override) — no separate
# "make this org an integrator" step is needed.
#
# Env:
#   API   base URL of the saas-backend API (default http://localhost:8080)
#   MH    base URL of the MailHog HTTP API (default http://localhost:8025)
#   EMAIL email to register (default a timestamped throwaway address)
#   PASS  password to register (default a fixed test password)
#
# Prints INTEGRATION_API_KEY=vsk_... and INTEGRATION_ORG_ADDRESS=0x... (the
# integrator organization, whose wallet scripts/integration-stack.sh funds) on
# stdout. When $GITHUB_OUTPUT is set,
# also appends `api_key=vsk_...` and `api_url=$API` there for use by later
# workflow steps.
set -euo pipefail

API="${API:-http://localhost:8080}"
MH="${MH:-http://localhost:8025}"
EMAIL="${EMAIL:-ci-$(date +%s)@test.local}"
PASS="${PASS:-integrationpass123}"
CURL_TIMEOUT=15

# Extract a field from JSON on stdin, e.g. `j "['token']"` or `j "['data']['address']"`.
j() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }

echo "== 1. register $EMAIL" >&2
curl -fsS -m "$CURL_TIMEOUT" -X POST "$API/users" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"firstName\":\"CI\",\"lastName\":\"Bot\"}" \
  -o /dev/null

echo "== 2. read verification code from MailHog" >&2
CODE=""
for i in $(seq 1 30); do
  CODE=$(curl -fsS -m "$CURL_TIMEOUT" "$MH/api/v2/search?kind=to&query=$EMAIL" | python3 -c "
import sys, json, quopri, re
d = json.load(sys.stdin)
for m in d.get('items', []):
    body = quopri.decodestring(m['Content']['Body']).decode('utf8', 'replace')
    # The MailHog body is quoted-printable. Do NOT match 'code=(\w+)' — QP
    # encodes '=' as '=3D', so 'code=843885' becomes 'code=3D843885' and that
    # pattern silently captures the wrong thing.
    g = re.search(r'verification code is:\s*([A-Za-z0-9]+)', body)
    if g:
        print(g.group(1))
        break
" || true)
  [ -n "$CODE" ] && break
  sleep 2
done
if [ -z "$CODE" ]; then
  echo "ERROR: no verification code found in MailHog for $EMAIL after 60s" >&2
  exit 1
fi
echo "   code=$CODE" >&2

echo "== 3. verify email" >&2
curl -fsS -m "$CURL_TIMEOUT" -X POST "$API/users/verify" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"code\":\"$CODE\"}" -o /dev/null

echo "== 4. login" >&2
TOKEN=$(curl -fsS -m "$CURL_TIMEOUT" -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | j "['token']")
if [ -z "$TOKEN" ] || [ "$TOKEN" = "None" ]; then
  echo "ERROR: login did not return a token" >&2
  exit 1
fi
echo "   token=${TOKEN:0:24}..." >&2

echo "== 5. create organization" >&2
ORG_JSON=$(curl -fsS -m "$CURL_TIMEOUT" -X POST "$API/organizations" -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" -d '{"type":"company","website":"https://ci.example"}')
ORG=$(printf '%s' "$ORG_JSON" | j "['address']")
if [ -z "$ORG" ] || [ "$ORG" = "None" ]; then
  echo "ERROR: organization creation did not return an address" >&2
  exit 1
fi
echo "   org=$ORG" >&2

echo "== 6. create integrator API key" >&2
KEY_JSON=$(curl -fsS -m "$CURL_TIMEOUT" -X POST "$API/integrator/organizations/$ORG/apikeys" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"label":"ci","scopes":["managed:write","members:write","voting:write","managed:read","quota:read"]}')
KEY=$(printf '%s' "$KEY_JSON" | j "['secret']")
if [ -z "$KEY" ] || [ "$KEY" = "None" ]; then
  echo "ERROR: apikey creation did not return a secret" >&2
  exit 1
fi
echo "   key=${KEY:0:8}..." >&2

echo "INTEGRATION_API_KEY=$KEY"
echo "INTEGRATION_ORG_ADDRESS=$ORG"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "api_key=$KEY"
    echo "api_url=$API"
  } >>"$GITHUB_OUTPUT"
fi
