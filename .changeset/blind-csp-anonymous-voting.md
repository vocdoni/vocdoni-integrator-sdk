---
'@vocdoni/api-types': major
'@vocdoni/api-client': major
'@vocdoni/api-voting': minor
'@vocdoni/react-providers': minor
'@vocdoni/api-voting-zk': patch
---

Support anonymous (blind CSP) voting end to end.

A census can now be created with `anonymous: true` (vocdoni/saas-backend#641). Such a process publishes under the `OFF_CHAIN_CA_V2` census origin (vocdoni/vocdoni-node#1434) with the CSP's *blind* public key as census root: the CSP signs a ballot it cannot read, so it can no longer link the authorization it granted to the vote that appears on chain. Until now every SaaS process was CSP-based but linkable — the CSP signed a `CAbundle` carrying the voter's plaintext ephemeral address.

The blind and unblind operations are the voter's, by construction, so they have to live in the SDK. This adds them:

- **`@vocdoni/api-types`** — `CensusSpec.anonymous` and the `BlindPoint*` / `BlindSign*` request and response types. Both blind rounds reuse the batch sign's `SignBatchResult` and `SignFailureCode`, which the sign-batch release adds; the two blind-only codes are `blind_request_missing` and `invalid_blinded_message`.
- **`@vocdoni/api-client`** — `processes.blindPoint()` and `processes.blindSign()`, the two rounds. There is no single-election blind endpoint: authorization is checked once per batch.
- **`@vocdoni/api-voting`** — `signBlindCspBallots()` runs both rounds and the client-side blinding in one call, returning the same result shape as the plain batch sign. The primitives (`blind`, `unblind`, `decompressBlindPoint`, `serializeBlindSignature`, `blindMessageFromBundle`) are exported for custom flows; they are built on the already-present `@noble/curves`, add no dependency, and their encodings are pinned byte-for-byte against Go-generated fixtures from `arnaucube/go-blindsecp256k1`. `buildCaBundle` / `encodeCaBundle` are now exported so the bundle that gets blinded and the bundle that goes on chain are built at one site and cannot drift apart.
- **`@vocdoni/react-providers`** — `useElectionAuth().signBatch()` picks the plain or blind flow itself from `census.anonymous`, and `ElectionProvider.vote()` tags anonymous ballots `ProofCA_Type.ECDSA_BLIND_PIDSALTED`. Nothing to configure — an anonymous process votes anonymously.

This is a blind signature, not zero-knowledge: `EnvelopeType.Anonymous` stays `false` and `@vocdoni/api-voting-zk` remains a separate, unrelated path.

**BREAKING CHANGE:** `QuestionConsumedAddress.address` and `.nullifier` are now optional (`string` → `string | undefined`). An anonymous census reports neither — the CSP never learns the address — so the backend omits them, and the type has to admit it. TypeScript code that reads either field unconditionally stops compiling; the fix is a guard:

```ts
// before
const nullifier = entry.nullifier.toLowerCase()
// after
const nullifier = entry.nullifier?.toLowerCase()
```

Runtime behaviour on a non-anonymous process is unchanged: both fields are still populated on every `sign-info` entry. `@vocdoni/api-client` majors with the types it re-exports. The practical consequence is that vote ids on an anonymous process exist only for the session that cast them: `useElection().voteIds` cannot be recovered from `sign-info` after a reload.

`@vocdoni/proto` is bumped `1.15.13` → `1.15.14` in the three packages that pin it exactly. The published diff is one additive line (`CensusOrigin.OFF_CHAIN_CA_V2`); nothing here needs it to build, but the pin is the version of the protocol the SDK claims to speak. `@vocdoni/api-voting-zk` moves only for that.
