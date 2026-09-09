---
"@vocdoni/api-voting-zk": patch
---

Remove the now-unused `circomlibjs` dependency. Poseidon hashing moved to `@noble/curves` in the previous release and nothing imports `circomlibjs` any more, but it was still declared in `package.json` and therefore still installed by every consumer. Dropping it prunes 57 packages from the install tree; no runtime behaviour changes.
