#!/usr/bin/env bash
# Derives the sticky upstream refs of a PR from its `/integration` comments.
# Walks owner/member/collaborator comments oldest first: a sticky comment sets
# the state, `/integration reset` clears it, one-shot comments leave it alone.
#
# Usage:
#   gh api --paginate "repos/$REPO/issues/$PR/comments" | jq -s 'add // []' | scripts/integration-sticky.sh
#
# Input: JSON array of issue comments on stdin, oldest first ({body, author_association}).
# Output (stdout, exit 0): vocdoni_node_ref=<ref or empty>, saas_backend_ref=<ref or empty>
set -euo pipefail

pins="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/integration-pins.sh"

# Bodies are base64-encoded so newlines and quotes survive the shell loop.
encoded="$(jq -r '.[] | select(.author_association == "OWNER" or .author_association == "MEMBER" or .author_association == "COLLABORATOR") | (.body // "") | @base64')"

node_ref=""
saas_ref=""
while IFS= read -r b64; do
  [ -n "$b64" ] || continue
  body="$(printf '%s' "$b64" | base64 -d)"
  if ! parsed="$(printf '%s\n' "$body" | "$pins" 2>/dev/null)"; then
    continue
  fi
  if [ "$(sed -n 's/^reset=//p' <<<"$parsed")" = true ]; then
    node_ref=""
    saas_ref=""
  elif [ "$(sed -n 's/^sticky=//p' <<<"$parsed")" = true ]; then
    node_ref="$(sed -n 's/^vocdoni_node_ref=//p' <<<"$parsed")"
    saas_ref="$(sed -n 's/^saas_backend_ref=//p' <<<"$parsed")"
  fi
done <<<"$encoded"

printf 'vocdoni_node_ref=%s\nsaas_backend_ref=%s\n' "$node_ref" "$saas_ref"
