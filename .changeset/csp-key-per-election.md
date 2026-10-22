---
'@vocdoni/api-types': minor
'@vocdoni/api-voting': minor
'@vocdoni/react-providers': minor
'@vocdoni/api-voting-zk': patch
---

Per-election CSP keys (census origins `OFF_CHAIN_CA_V3_ECDSA` and `OFF_CHAIN_CA_V3_BLIND`). `SignBatchResult` and `AuthResponse` carry the `proofType` the CSP names for each signature, and a blind signature of a V3 blind election also carries `weightKey` and `weightCertificate`. `signBlindCspBallots` returns them, `buildVoteTransaction` takes an optional `weightCertificate` and puts it in `ProofCA.weightCertificate` (the proof type then defaults to `ECDSA_BLIND`), and the new `cspProofOptions(result, fallback)` turns a CSP result into the proof options of a vote. `ElectionProvider` votes with the proof type the CSP returns and falls back to `ECDSA_BLIND_PIDSALTED` for an anonymous census and `ECDSA_PIDSALTED` otherwise when it returns none. `@vocdoni/proto` moves to 1.18.0.
