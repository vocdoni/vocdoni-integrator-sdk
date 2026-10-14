#!/usr/bin/env bash
# Builds a vocdoni upstream image from source at a given ref, for running the
# integration stack against an unpublished commit. Neither upstream publishes
# per-commit images, so this is the only way to get one.
#
# Usage:
#   scripts/integration-build-image.sh <vocdoni-node|saas-backend> <ref>
#
# Output (stdout; everything else goes to stderr):
#   image=integrator-sdk-integration/<repo>:<sha>
#   sha=<full commit sha>
# Feed the image to the stack as VOCDONI_NODE_IMAGE or SAAS_BACKEND_IMAGE.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <vocdoni-node|saas-backend> <ref>" >&2
  exit 1
fi
repo="$1"
ref="$2"

case "$repo" in
  vocdoni-node | saas-backend) ;;
  *)
    echo "ERROR: unknown repo '$repo' (expected vocdoni-node or saas-backend)" >&2
    exit 1
    ;;
esac
if ! [[ "$ref" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$ ]] || [[ "$ref" == *..* ]]; then
  echo "ERROR: invalid ref '$ref'" >&2
  exit 1
fi

dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT

# Resolves the ref through the GitHub API, which takes a branch, tag or short/full
# SHA (fork PR heads included), then shallow-fetches exactly that commit.
auth=()
if [ -n "${GH_TOKEN:-}" ]; then
  auth=(-H "Authorization: Bearer $GH_TOKEN")
fi
body="$dir/resolve.txt"
if curl -fsSL ${auth[@]+"${auth[@]}"} -H 'Accept: application/vnd.github.sha' \
  "https://api.github.com/repos/vocdoni/$repo/commits/$ref" -o "$body"; then
  sha="$(cat "$body")"
else
  sha=""
fi
rm -f "$body"
if ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "ERROR: could not resolve '$ref' in vocdoni/$repo" >&2
  exit 1
fi
git -C "$dir" init --quiet >&2
git -C "$dir" fetch --quiet --depth 1 "https://github.com/vocdoni/$repo.git" "$sha" >&2
git -C "$dir" checkout --quiet FETCH_HEAD >&2

tag="integrator-sdk-integration/$repo:$sha"
echo "== building $repo@$sha" >&2
export DOCKER_BUILDKIT=1
if [ "$repo" = vocdoni-node ]; then
  docker build --platform linux/amd64 -t "$tag" "$dir" >&2
else
  go_version="$(awk '/^go [0-9]/ { print $2; exit }' "$dir/go.mod")"
  if [ -z "$go_version" ]; then
    echo "ERROR: no 'go' directive found in saas-backend go.mod" >&2
    exit 1
  fi
  docker build --platform linux/amd64 --build-arg "GOLANG_VERSION=$go_version" -t "$tag" "$dir" >&2
fi

printf 'image=%s\nsha=%s\n' "$tag" "$sha"
