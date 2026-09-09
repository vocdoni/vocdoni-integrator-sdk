---
"@vocdoni/api-voting-zk": patch
---

Replace the `circomlibjs` Poseidon hash with an equivalent built on `@noble/curves`. Output is bit-for-bit identical (pinned by regression tests against circomlibjs reference vectors) and the built output no longer imports `circomlibjs` at runtime. `circomlibjs` remains listed in `package.json` but is no longer imported.
