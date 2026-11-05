#!/usr/bin/env bash
# Parses a `/integration` PR comment into the upstream refs to build for the
# integration stack. Only the first line counts; every key is optional.
#
# Usage:
#   printf '%s' "$COMMENT_BODY" | scripts/integration-pins.sh
#
# Example first line: /integration vocdoni-node=1a2b3c4 saas-backend=795
#   or: /integration reset
# A ref is a commit SHA (7-40 hex), a branch or tag, or a PR: #<N>, or a bare
# <N> of 1-6 digits. Both are output as #<N> without leading zeros. A branch or
# tag named only with 1-6 digits can't be pinned by name.
# sticky=true when refs are given and none is a SHA: the refs are re-resolved
# on every push until `/integration reset`. A comment with any SHA runs once.
#
# Env: none. Input: the comment body on stdin.
# Output (stdout, exit 0):
#   vocdoni_node_ref=<ref or empty>
#   saas_backend_ref=<ref or empty>
#   sticky=true|false
#   reset=true|false
# Errors go to stderr with exit 1. The ref grammar blocks leading '-' and '..',
# so a ref can never be read by git or docker as an option or a path escape.
set -euo pipefail
# [0-9] would match non-ASCII digits in other locales.
export LC_ALL=C

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

if [ "${#tokens[@]}" -gt 0 ] && [ "${tokens[0]}" = reset ]; then
  [ "${#tokens[@]}" = 1 ] || fail "'reset' takes no other tokens"
  printf 'vocdoni_node_ref=\nsaas_backend_ref=\nsticky=false\nreset=true\n'
  exit 0
fi

node_ref=""
saas_ref=""
seen_node=0
seen_saas=0
sticky_refs=0
sha_refs=0
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
      ;;
    saas-backend)
      [ "$seen_saas" = 0 ] || fail "saas-backend given twice"
      seen_saas=1
      ;;
    *)
      fail "unknown key '$key' (expected vocdoni-node or saas-backend)"
      ;;
  esac
  # A bare PR number means the same as #N: GitHub autolinks #N to this repo.
  if [[ "$ref" =~ ^[0-9]{1,6}$ ]]; then
    ref="#$ref"
  fi
  # Leading zeros go: the build resolves #N as refs/pull/N, so #0795 is #795.
  if [[ "$ref" =~ ^#[0-9]{1,9}$ ]]; then
    pr=$((10#${ref#'#'}))
    [ "$pr" -gt 0 ] || fail "PR number for '$key' must be above 0 (got '${tok#*=}')"
    ref="#$pr"
  fi
  [ -n "$ref" ] || fail "empty ref for '$key'"
  if [[ "$ref" =~ ^#[0-9]{1,9}$ ]]; then
    sticky_refs=$((sticky_refs + 1))
  elif [[ "$ref" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$ ]] && [[ "$ref" != *..* ]]; then
    if [[ "$ref" =~ ^[0-9A-Fa-f]{7,40}$ ]]; then
      sha_refs=$((sha_refs + 1))
    else
      sticky_refs=$((sticky_refs + 1))
    fi
  else
    fail "invalid ref '$ref' for '$key'"
  fi
  if [ "$key" = vocdoni-node ]; then
    node_ref="$ref"
  else
    saas_ref="$ref"
  fi
done

sticky=false
if [ "$sticky_refs" -gt 0 ] && [ "$sha_refs" = 0 ]; then
  sticky=true
fi

printf 'vocdoni_node_ref=%s\nsaas_backend_ref=%s\nsticky=%s\nreset=false\n' "$node_ref" "$saas_ref" "$sticky"
