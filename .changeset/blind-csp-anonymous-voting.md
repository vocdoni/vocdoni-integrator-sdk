---
'@vocdoni/api-types': minor
'@vocdoni/api-client': minor
'@vocdoni/api-voting': minor
'@vocdoni/react-providers': minor
'@vocdoni/api-voting-zk': patch
---

Support anonymous (blind CSP) voting end to end.

A census can now be created with `anonymous: true` (vocdoni/saas-backend#641). Such a process publishes under the `OFF_CHAIN_CA_V2` census origin (vocdoni/vocdoni-node#1434) with the CSP's *blind* public key as census root: the CSP signs a ballot it cannot read, so it can no longer link the authorization it granted to the vote that appears on chain. Until now every SaaS process was CSP-based but linkable — the CSP signed a `CAbundle` carrying the voter's plaintext ephemeral address.

The blind and unblind operations are the voter's, by construction, so they have to live in the SDK. This adds them:

- **`@vocdoni/api-types`** — `CensusSpec.anonymous`; the `SignBatch*` / `BlindPoint*` / `BlindSign*` request and response types; the `SignFailureCode` union of the backend's stable per-question failure codes.
- **`@vocdoni/api-client`** — `processes.blindPoint()`, `processes.blindSign()` and `processes.signBatch()`. `sign-batch` is the non-anonymous counterpart the backend has exposed for a while and the SDK never wrapped; adding it keeps both vote paths batch-shaped instead of leaving one looping and one batching.
- **`@vocdoni/api-voting`** — `signBlindCspBallots()` runs both rounds and the client-side blinding in one call, returning the same result shape as the plain batch sign. The primitives (`blind`, `unblind`, `decompressBlindPoint`, `serializeBlindSignature`, `blindMessageFromBundle`) are exported for custom flows; they are built on the already-present `@noble/curves`, add no dependency, and their encodings are pinned byte-for-byte against Go-generated fixtures from `arnaucube/go-blindsecp256k1`. `buildCaBundle` / `encodeCaBundle` are now exported so the bundle that gets blinded and the bundle that goes on chain are built at one site and cannot drift apart.
- **`@vocdoni/react-providers`** — `useElectionAuth().signBatch()` signs every question in one call and picks the plain or blind flow itself from `census.anonymous`; `ElectionProvider.vote()` uses it and tags anonymous ballots `ProofCA_Type.ECDSA_BLIND_PIDSALTED`. Nothing to configure — an anonymous process votes anonymously.

This is a blind signature, not zero-knowledge: `EnvelopeType.Anonymous` stays `false` and `@vocdoni/api-voting-zk` remains a separate, unrelated path.

**Type-level break:** `QuestionConsumedAddress.address` and `.nullifier` are now optional. An anonymous census reports neither — the CSP never learns the address — so the backend omits them. Code that read either field unconditionally needs a guard. The practical consequence is that vote ids on an anonymous process exist only for the session that cast them: `useElection().voteIds` cannot be recovered from `sign-info` after a reload.

**Why this is a minor and not a major.** Widening a property to optional is nominally breaking, but nothing that works today stops working: a non-anonymous census still returns both fields on every `sign-info` entry, byte for byte as before. The only code the change can reach is a reader of those two fields, and only once it points at an anonymous census — where the value never existed to begin with, because the CSP never learned the address. A reader that adds the guard keeps behaving identically on every process it already handles.

`@vocdoni/proto` is bumped `1.15.13` → `1.15.14` in the three packages that pin it exactly. The published diff is one additive line (`CensusOrigin.OFF_CHAIN_CA_V2`); nothing here needs it to build, but the pin is the version of the protocol the SDK claims to speak. `@vocdoni/api-voting-zk` moves only for that.
