# @vocdoni/api-voting

## 1.1.0

### Minor Changes

- e6ff0b2: Support anonymous (blind CSP) voting end to end.

  A census can now be created with `anonymous: true` (vocdoni/saas-backend#641). Such a process publishes under the `OFF_CHAIN_CA_V2` census origin (vocdoni/vocdoni-node#1434) with the CSP's _blind_ public key as census root: the CSP signs a ballot it cannot read, so it can no longer link the authorization it granted to the vote that appears on chain. Until now every SaaS process was CSP-based but linkable — the CSP signed a `CAbundle` carrying the voter's plaintext ephemeral address.

  The blind and unblind operations are the voter's, by construction, so they have to live in the SDK. This adds them:

  - **`@vocdoni/api-types`** — `CensusSpec.anonymous` and the `BlindPoint*` / `BlindSign*` request and response types. Both blind rounds reuse the batch sign's `SignBatchResult` and `SignFailureCode`, which the sign-batch release adds; the two blind-only codes are `blind_request_missing` and `invalid_blinded_message`.
  - **`@vocdoni/api-client`** — `processes.blindPoint()` and `processes.blindSign()`, the two rounds. There is no single-election blind endpoint: authorization is checked once per batch.
  - **`@vocdoni/api-voting`** — `signBlindCspBallots()` runs both rounds and the client-side blinding in one call, returning the same result shape as the plain batch sign. The primitives (`blind`, `unblind`, `decompressBlindPoint`, `serializeBlindSignature`, `blindMessageFromBundle`) are exported for custom flows; they are built on the already-present `@noble/curves`, add no dependency, and their encodings are pinned byte-for-byte against Go-generated fixtures from `arnaucube/go-blindsecp256k1`. `buildCaBundle` / `encodeCaBundle` are now exported so the bundle that gets blinded and the bundle that goes on chain are built at one site and cannot drift apart.
  - **`@vocdoni/react-providers`** — `useElectionAuth().signBatch()` picks the plain or blind flow itself from `census.anonymous`, and `ElectionProvider.vote()` tags anonymous ballots `ProofCA_Type.ECDSA_BLIND_PIDSALTED`. Nothing to configure — an anonymous process votes anonymously.

  This is a blind signature, not zero-knowledge: `EnvelopeType.Anonymous` stays `false` and `@vocdoni/api-voting-zk` remains a separate, unrelated path.

  **BREAKING CHANGE:** `QuestionConsumedAddress.address` and `.nullifier` are now optional (`string` → `string | undefined`). An anonymous census reports neither — the CSP never learns the address — so the backend omits them, and the type has to admit it. TypeScript code that reads either field unconditionally stops compiling; the fix is a guard:

  ```ts
  // before
  const nullifier = entry.nullifier.toLowerCase();
  // after
  const nullifier = entry.nullifier?.toLowerCase();
  ```

  Runtime behaviour on a non-anonymous process is unchanged: both fields are still populated on every `sign-info` entry. `@vocdoni/api-client` majors with the types it re-exports. The practical consequence is that vote ids on an anonymous process exist only for the session that cast them: `useElection().voteIds` cannot be recovered from `sign-info` after a reload.

  `@vocdoni/proto` is bumped `1.15.13` → `1.15.14` in the packages that pin it exactly. The published diff is one additive line (`CensusOrigin.OFF_CHAIN_CA_V2`); nothing here needs it to build, but the pin is the version of the protocol the SDK claims to speak.

### Patch Changes

- Updated dependencies [e6ff0b2]
- Updated dependencies [7492468]
  - @vocdoni/api-types@2.0.0

## 1.0.1

### Patch Changes

- Updated dependencies [d9212f0]
  - @vocdoni/api-types@1.2.0

## 1.0.0

### Major Changes

- 242f6f0: Promote `@vocdoni/ballot` and `@vocdoni/api-voting` to 1.0.0.

  No API changes in either package — this is a versioning fix.

  While they sat on `0.x`, every additive change forced a **major** on the React
  packages. `^0.1.2` means `>=0.1.2 <0.2.0`, so a minor (`0.1.2` → `0.2.0`) is
  _out of range_ for a caret dependent and gets majored. That defeats the
  `onlyUpdatePeerDependentsWhenOutOfRange` fix, which only helps when the bump is
  genuinely in range — and for a `0.x` package a minor never is. The practical
  effect was that adding an export to `@vocdoni/ballot` had to ship as a `patch`
  just to avoid gratuitously majoring `@vocdoni/react-components`.

  At `1.x`, `^1.0.0` covers every later minor, so additive changes cascade as
  patches and can be declared honestly.

  The React packages take only a **patch**: their peer ranges on these two
  packages widen from `workspace:^` to `workspace:>=0.1.2 <2`, which spans both
  the old and new majors. That is accurate rather than a workaround — 1.0.0
  changes no API, so `react-components` really does work with both. Consumers on
  `@vocdoni/react-components@^2` keep working with no range change.

### Patch Changes

- Updated dependencies [e7a7dae]
  - @vocdoni/api-types@1.1.2

## 0.1.2

### Patch Changes

- Updated dependencies [f84bf33]
  - @vocdoni/api-types@1.1.1

## 0.1.1

### Patch Changes

- Updated dependencies [180a9b3]
- Updated dependencies [41497df]
- Updated dependencies [8212fcd]
  - @vocdoni/api-types@1.1.0

## 0.1.0

### Minor Changes

- da921fc: New optional `memo` on `buildVoteTransaction` / `VotingClient.vote()` —
  attaches a free-text note (e.g. an open "Other" answer) to the vote envelope
  (`VoteEnvelope.memo`, new in `@vocdoni/proto` 1.15.13). Validated client-side
  against the chain's 256 UTF-8-byte cap (exported as `MAX_MEMO_BYTES`), since
  the protocol leaves memo validation to the app layer. Note the memo rides the
  envelope in cleartext even on `secretUntilTheEnd` elections — only the vote
  package is encrypted.

### Patch Changes

- 111b400: Bump `@vocdoni/proto` to 1.15.13. The only upstream proto change is the new
  optional `VoteEnvelope.memo` field (voter free-text note, max 256 bytes) —
  additive, not yet set by this SDK.

  The 1.15.13 build also bundles a newer protobufjs whose `Writer.finish()`
  returns a `Buffer` whenever a global one is reachable; in jsdom/VM test realms
  that Buffer fails `instanceof Uint8Array`, which noble's strict byte checks
  reject. `buildVoteTransaction` now normalizes the encoded bytes to the local
  realm, so consumers' jsdom test suites keep working.

- Updated dependencies [915f278]
- Updated dependencies [d65439b]
- Updated dependencies [9bb1937]
- Updated dependencies [a280996]
- Updated dependencies [7801e6d]
- Updated dependencies [0d630b3]
- Updated dependencies [19a0b09]
- Updated dependencies [0f27337]
- Updated dependencies [0b4c33b]
- Updated dependencies [2a0cbed]
  - @vocdoni/api-types@1.0.0

## 0.0.1

### Patch Changes

- Initial release
- Updated dependencies
  - @vocdoni/api-types@0.0.1
