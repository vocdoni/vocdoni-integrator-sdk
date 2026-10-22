#!/usr/bin/env bash
# Builds a vocdoni upstream image from source at a given ref, for running the
# integration stack against an unpublished commit. Neither upstream publishes
# per-commit images, so this is the only way to get one. saas-backend is private and is
# cloned over SSH: with SAAS_BACKEND_DEPLOY_KEY in CI, with your own SSH key otherwise.
#
# Usage:
#   scripts/integration-build-image.sh <vocdoni-node|saas-backend> <ref|#PR>
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
if ! [[ "$ref" =~ ^#[0-9]{1,9}$ || "$ref" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$ ]] || [[ "$ref" == *..* ]]; then
  echo "ERROR: invalid ref '$ref'" >&2
  exit 1
fi

if [ "$repo" = saas-backend ] && [ "${GITHUB_ACTIONS:-}" = true ] && [ -z "${SAAS_BACKEND_DEPLOY_KEY:-}" ]; then
  echo "ERROR: SAAS_BACKEND_DEPLOY_KEY is empty: saas-backend is private. Fork PRs get no secrets, so a maintainer's /integration comment must run it." >&2
  exit 1
fi

dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT

# Full SHAs are fetched as they are. Other refs resolve in a throwaway bare repo that holds
# every branch, tag and PR head (no trees or blobs), so a short SHA only resolves if one of
# them reaches it. saas-backend is private: SSH with SAAS_BACKEND_DEPLOY_KEY in CI, your own key otherwise.
url="https://github.com/vocdoni/$repo.git"
if [ "$repo" = saas-backend ]; then
  url="git@github.com:vocdoni/$repo.git"
  if [ -n "${SAAS_BACKEND_DEPLOY_KEY:-}" ]; then
    printf '%s\n' "$SAAS_BACKEND_DEPLOY_KEY" > "$dir/deploy_key"
    chmod 600 "$dir/deploy_key"
    echo "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl" > "$dir/known_hosts"
    export GIT_SSH_COMMAND="ssh -i '$dir/deploy_key' -o IdentitiesOnly=yes -o UserKnownHostsFile='$dir/known_hosts'"
  fi
fi
refs="$dir/refs"
sha=""
if [[ "$ref" =~ ^[0-9A-Fa-f]{40}$ ]]; then
  sha="$(printf '%s' "$ref" | tr '[:upper:]' '[:lower:]')"
else
  git init --quiet --bare "$refs" >&2
  git -C "$refs" fetch --quiet --filter=tree:0 "$url" \
    '+refs/heads/*:refs/heads/*' '+refs/tags/*:refs/tags/*' '+refs/pull/*/head:refs/pull/*' >&2
  if [[ "$ref" =~ ^#[0-9]+$ ]]; then
    sha="$(git -C "$refs" rev-parse --verify --quiet "refs/pull/${ref:1}^{commit}" || true)"
  else
    sha="$(git -C "$refs" rev-parse --verify --quiet "refs/heads/$ref^{commit}" || true)"
    if [ -z "$sha" ]; then
      sha="$(git -C "$refs" rev-parse --verify --quiet "refs/tags/$ref^{commit}" || true)"
    fi
    if [ -z "$sha" ] && [[ "$ref" =~ ^[0-9A-Fa-f]{7,39}$ ]]; then
      sha="$(git -C "$refs" rev-parse --verify --quiet "$ref^{commit}" || true)"
    fi
  fi
fi
if ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "ERROR: could not resolve '$ref' in vocdoni/$repo" >&2
  exit 1
fi
src="$dir/src"
git init --quiet "$src" >&2
git -C "$src" fetch --quiet --depth 1 "$url" "$sha" >&2
git -C "$src" checkout --quiet FETCH_HEAD >&2

tag="integrator-sdk-integration/$repo:$sha"
echo "== building $repo@$sha" >&2
export DOCKER_BUILDKIT=1
if [ "$repo" = vocdoni-node ]; then
  docker build --platform linux/amd64 -t "$tag" "$src" >&2
else
  go_version="$(awk '/^go [0-9]/ { print $2; exit }' "$src/go.mod")"
  if [ -z "$go_version" ]; then
    echo "ERROR: no 'go' directive found in saas-backend go.mod" >&2
    exit 1
  fi
  docker build --platform linux/amd64 --build-arg "GOLANG_VERSION=$go_version" -t "$tag" "$src" >&2
fi

printf 'image=%s\nsha=%s\n' "$tag" "$sha"
