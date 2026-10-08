#!/usr/bin/env bash
# Manages the disposable mongo + vocone + saas-backend stack that
# integration/full-flow.itest.ts runs against. Used identically by a
# developer's laptop and by .github/workflows/integration.yml.
#
# Usage:
#   scripts/integration-stack.sh up    # start the stack, seed it, mint an integrator key, fund its wallet
#   scripts/integration-stack.sh down  # tear the stack down (drops volumes)
#   scripts/integration-stack.sh run   # up, then run the integration suite, env pre-wired
#
# Env:
#   INTEGRATION_HOST_PORT    host port the saas-backend API is published on (default 8080)
#   INTEGRATION_MAILHOG_PORT host port the MailHog HTTP API is published on (default 8025)
#   INTEGRATION_WALLET_CENTS integrator wallet balance to seed, in euro cents (default 100000)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/integration/docker-compose.ci.yml"
SEED_FILE="$REPO_ROOT/integration/seed-plan.js"
WALLET_SEED_FILE="$REPO_ROOT/integration/seed-wallet.js"
BOOTSTRAP_SCRIPT="$SCRIPT_DIR/ci-bootstrap-integrator.sh"

INTEGRATION_HOST_PORT="${INTEGRATION_HOST_PORT:-8080}"
INTEGRATION_MAILHOG_PORT="${INTEGRATION_MAILHOG_PORT:-8025}"
# A full run spends €325 (5 processes at €65) with no refund; €100k lasts ~300 runs of one stack.
INTEGRATION_WALLET_CENTS="${INTEGRATION_WALLET_CENTS:-10000000}"
export INTEGRATION_HOST_PORT INTEGRATION_MAILHOG_PORT

INTEGRATION_API_URL="http://localhost:${INTEGRATION_HOST_PORT}"

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

# Runs a mongosh script; extra args go to `compose exec` (e.g. `-e NAME=value`).
# Via --eval, not stdin: on stdin mongosh survives an uncaught error and exits 0.
mongo_script() {
  local file="$1"
  shift
  compose exec -T "$@" mongo mongosh --quiet 'mongodb://root:vocdoni@localhost:27017/admin' --eval "$(cat "$file")" >&2
}

# Prints Python expression $1 over the JSON on stdin (as `d`), or nothing when
# the body is not JSON or the expression fails, so a missing field is not a zero.
json_get() {
  python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print($1)
except Exception:
    pass
" 2>/dev/null || true
}

# True (exit 0) if nothing is listening on 127.0.0.1:$1. Uses bash's built-in
# /dev/tcp pseudo-device so no extra tooling (lsof, nc...) is required on
# either a laptop or a GitHub runner.
#
# The probe runs in a subshell, so the descriptor it opens dies with that
# subshell and there is nothing to clean up here. Do NOT add an `exec 3>&- ...`
# cleanup line: `exec` with redirections and no command applies them to the
# *current shell* permanently, so a trailing `2>/dev/null` on it silently
# discards every later error message in this script — including the "port is
# already in use" one immediately below.
port_is_free() {
  local port="$1"
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    return 1
  fi
  return 0
}

wait_container_healthy() {
  local service="$1" timeout_s="$2" waited=0
  local cid
  cid=$(compose ps -q "$service")
  if [ -z "$cid" ]; then
    echo "ERROR: service '$service' is not running" >&2
    return 1
  fi
  while true; do
    local status
    status=$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo "unknown")
    [ "$status" = "healthy" ] && return 0
    if [ "$waited" -ge "$timeout_s" ]; then
      echo "ERROR: service '$service' did not become healthy within ${timeout_s}s (last status: $status)" >&2
      return 1
    fi
    sleep 3
    waited=$((waited + 3))
  done
}

wait_api_ready() {
  local timeout_s="$1" waited=0
  while true; do
    if curl -fsS -m 5 "$INTEGRATION_API_URL/ping" -o /dev/null 2>/dev/null; then
      return 0
    fi
    if [ "$waited" -ge "$timeout_s" ]; then
      echo "ERROR: api did not answer GET /ping within ${timeout_s}s" >&2
      return 1
    fi
    sleep 3
    waited=$((waited + 3))
  done
}

cmd_up() {
  # NumberLong silently turns "1e5" into 1 and wraps past int64: digits only.
  if ! [[ "$INTEGRATION_WALLET_CENTS" =~ ^[1-9][0-9]{0,17}$ ]]; then
    echo "ERROR: INTEGRATION_WALLET_CENTS must be a positive whole number of cents, got '$INTEGRATION_WALLET_CENTS'" >&2
    exit 1
  fi
  if ! port_is_free "$INTEGRATION_HOST_PORT"; then
    echo "ERROR: host port $INTEGRATION_HOST_PORT is already in use. Set INTEGRATION_HOST_PORT to a free port and retry, e.g. INTEGRATION_HOST_PORT=$((INTEGRATION_HOST_PORT + 10000))." >&2
    exit 1
  fi
  if ! port_is_free "$INTEGRATION_MAILHOG_PORT"; then
    echo "ERROR: host port $INTEGRATION_MAILHOG_PORT is already in use. Set INTEGRATION_MAILHOG_PORT to a free port and retry." >&2
    exit 1
  fi

  echo "== starting stack" >&2
  compose up -d

  echo "== waiting for mongo and vocone to be healthy" >&2
  wait_container_healthy mongo 60
  # Kept above vocone's own healthcheck window (~420s, see the compose file):
  # `compose up -d` already gates on that via depends_on/service_healthy, so
  # this is only a backstop for the case where the container is healthy-but-slow
  # to report. Do not tighten it below the compose window.
  wait_container_healthy vocone 450

  echo "== seeding default plan" >&2
  mongo_script "$SEED_FILE"

  echo "== waiting for api to answer /ping" >&2
  wait_api_ready 60

  echo "== asserting the plan seed took" >&2
  PLANS_JSON=$(curl -fsS -m 10 "$INTEGRATION_API_URL/plans" || echo "")
  # Separate "could not ask" from "asked, got nothing". Without this the seed
  # assertion below blames db.Plan bson tags for what is really a dead API —
  # observed for real while reviewing this script.
  if [ -z "$PLANS_JSON" ]; then
    echo "ERROR: GET $INTEGRATION_API_URL/plans did not respond — the api container is not serving. This is NOT a seed problem; check the api logs." >&2
    exit 1
  fi
  PLANS_COUNT=$(printf '%s' "$PLANS_JSON" | json_get "len(d) if isinstance(d, list) else 0")
  if [ "${PLANS_COUNT:-0}" -lt 1 ] 2>/dev/null; then
    echo "plan seed did not take — check db.Plan bson tags against integration/seed-plan.js" >&2
    exit 1
  fi

  echo "== bootstrapping integrator user/org/key" >&2
  BOOTSTRAP_OUT=$(API="$INTEGRATION_API_URL" MH="http://localhost:${INTEGRATION_MAILHOG_PORT}" "$BOOTSTRAP_SCRIPT")
  INTEGRATION_API_KEY=$(printf '%s\n' "$BOOTSTRAP_OUT" | sed -n 's/^INTEGRATION_API_KEY=//p' | tail -1)
  if [ -z "$INTEGRATION_API_KEY" ]; then
    echo "ERROR: bootstrap did not produce an INTEGRATION_API_KEY" >&2
    exit 1
  fi
  INTEGRATOR_ORG_ADDRESS=$(printf '%s\n' "$BOOTSTRAP_OUT" | sed -n 's/^INTEGRATION_ORG_ADDRESS=//p' | tail -1)
  if [ -z "$INTEGRATOR_ORG_ADDRESS" ]; then
    echo "ERROR: bootstrap did not produce an INTEGRATION_ORG_ADDRESS" >&2
    exit 1
  fi

  echo "== funding integrator wallet with $INTEGRATION_WALLET_CENTS cents" >&2
  mongo_script "$WALLET_SEED_FILE" -e ORG_ADDRESS="$INTEGRATOR_ORG_ADDRESS" -e WALLET_CENTS="$INTEGRATION_WALLET_CENTS"

  echo "== asserting the wallet seed took" >&2
  # Read back through the API, proving the backend sees the seed as this integrator's wallet.
  local wallet_body wallet_status
  wallet_body=$(mktemp)
  wallet_status=$(curl -sS -m 10 -o "$wallet_body" -w '%{http_code}' \
    -H "Authorization: Bearer $INTEGRATION_API_KEY" "$INTEGRATION_API_URL/wallet" || echo "000")
  WALLET_JSON=$(cat "$wallet_body")
  rm -f "$wallet_body"
  case "$wallet_status" in
    200) ;;
    404)
      # Wallets arrived in saas-backend#706; an older SAAS_BACKEND_IMAGE has nothing to fund.
      echo "   GET /wallet is 404: this saas-backend predates integrator wallets; skipping the check" >&2
      ;;
    *)
      echo "ERROR: GET $INTEGRATION_API_URL/wallet answered HTTP $wallet_status — the api container is not serving or rejected the key. This is NOT a seed problem; check the api logs." >&2
      exit 1
      ;;
  esac
  if [ "$wallet_status" = 200 ]; then
    WALLET_CENTS_READ=$(printf '%s' "$WALLET_JSON" | json_get "int(d['balanceCents'])")
    if [ -z "$WALLET_CENTS_READ" ]; then
      echo "ERROR: GET /wallet has no integer balanceCents (body: $WALLET_JSON) — the API response changed shape; this is NOT a seed problem." >&2
      exit 1
    fi
    if [ "$WALLET_CENTS_READ" != "$INTEGRATION_WALLET_CENTS" ]; then
      echo "wallet seed did not take (API reports $WALLET_CENTS_READ cents) — check db.Wallet bson tags against integration/seed-wallet.js" >&2
      exit 1
    fi
  fi

  echo "INTEGRATION_API_URL=$INTEGRATION_API_URL"
  echo "INTEGRATION_API_KEY=$INTEGRATION_API_KEY"

  # cmd_run passes a file here rather than capturing our stdout: running cmd_up
  # inside `out=$(cmd_up)` would silently disable `set -e` for everything in it
  # (bash suppresses errexit inside a command substitution feeding an
  # assignment), so a dead stack would sail past every check and the suite would
  # run against nothing. See cmd_run.
  if [ -n "${INTEGRATION_ENV_FILE:-}" ]; then
    {
      echo "INTEGRATION_API_URL=$INTEGRATION_API_URL"
      echo "INTEGRATION_API_KEY=$INTEGRATION_API_KEY"
    } >"$INTEGRATION_ENV_FILE"
  fi

  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    {
      echo "api_url=$INTEGRATION_API_URL"
      echo "api_key=$INTEGRATION_API_KEY"
    } >>"$GITHUB_OUTPUT"
  fi
}

cmd_down() {
  compose down -v
}

cmd_run() {
  # cmd_up is called DIRECTLY, not as `out=$(cmd_up)`: bash disables errexit
  # inside a command substitution that feeds an assignment, so every failure in
  # cmd_up (compose up, health waits, the seed, the /ping wait) would be
  # swallowed and we would run the suite against a stack that never came up —
  # reporting a misleading "plan seed did not take" instead of the real cause.
  # The env vars come back via a file instead.
  local envfile
  envfile=$(mktemp)
  # shellcheck disable=SC2064
  trap "rm -f '$envfile'" EXIT
  INTEGRATION_ENV_FILE="$envfile" cmd_up
  # shellcheck source=/dev/null
  . "$envfile"
  export INTEGRATION_API_URL INTEGRATION_API_KEY
  (cd "$REPO_ROOT" && pnpm test:integration)
}

case "${1:-}" in
  up) cmd_up ;;
  down) cmd_down ;;
  run) cmd_run ;;
  *)
    echo "usage: $0 {up|down|run}" >&2
    exit 1
    ;;
esac
