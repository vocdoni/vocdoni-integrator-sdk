---
'@vocdoni/api-client': minor
'@vocdoni/api-types': patch
---

Add `hashMemberPassword(orgAddress, password)` to compute the client hash expected by `OrgMember.password` and `AuthRequest.password`, so integrators no longer copy the formula. The `AuthRequest.password` docs now give the correct wrong-password error (401, code 40802) instead of 40029.
