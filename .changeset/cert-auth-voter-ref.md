---
"@vocdoni/api-types": minor
"@vocdoni/react-providers": patch
---

Certificate voter authentication: `CensusSpec` gains `certAuth`, `AuthRequest` gains `certCode` and `codeVerifier`, and `AuthResponse` gains `voterRef`. `auth0` binds the tab's pending votes to the step-0 `voterRef` when the backend returns one, so a certificate voter (whose step-0 payload changes on every login) gets their pending vote re-sent after a reload.
