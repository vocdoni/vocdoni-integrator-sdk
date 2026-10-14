#!/usr/bin/env bash
# Parses a `/integration` PR comment into the upstream refs to build for the
# integration stack. Only the first line counts; every key is optional.
#
# Usage:
#   printf '%s' "$COMMENT_BODY" | scripts/integration-pins.sh
#
# Example first line: /integration vocdoni-node=1a2b3c4 saas-backend=feat/wallets
#
# Env: none. Input: the comment body on stdin.
# Output (stdout, exit 0):
#   vocdoni_node_ref=<ref or empty>
#   saas_backend_ref=<ref or empty>
# Errors go to stderr with exit 1. The ref grammar blocks leading '-' and '..',
# so a ref can never be read by git or docker as an option or a path escape.
set -euo pipefail

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

IFS= read -r line || true
line="${line%$'\r'}"

if ! [[ "$line" =~ ^/integration([[:space:]]|$) ]]; then
  fail "first line must start with '/integration' (got '$line')"
fi

tokens=()
read -ra tokens <<<"${line#/integration}" || true

node_ref=""
saas_ref=""
seen_node=0
seen_saas=0
for tok in ${tokens[@]+"${tokens[@]}"}; do
  if [[ "$tok" != *=* ]]; then
    fail "'$tok' is not key=ref"
  fi
  key="${tok%%=*}"
  ref="${tok#*=}"
  case "$key" in
    vocdoni-node)
      [ "$seen_node" = 0 ] || fail "vocdoni-node given twice"
      seen_node=1
      node_ref="$ref"
      ;;
    saas-backend)
      [ "$seen_saas" = 0 ] || fail "saas-backend given twice"
      seen_saas=1
      saas_ref="$ref"
      ;;
    *)
      fail "unknown key '$key' (expected vocdoni-node or saas-backend)"
      ;;
  esac
  [ -n "$ref" ] || fail "empty ref for '$key'"
  if ! [[ "$ref" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$ ]] || [[ "$ref" == *..* ]]; then
    fail "invalid ref '$ref' for '$key'"
  fi
done

printf 'vocdoni_node_ref=%s\nsaas_backend_ref=%s\n' "$node_ref" "$saas_ref"
