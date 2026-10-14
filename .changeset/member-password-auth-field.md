---
'@vocdoni/api-types': minor
---

Member passwords as a voter credential. `OrgMemberAuthField` gains `'password'`, so a process census can require the member password next to its other auth fields, and `AuthRequest` gains `password` for auth step 0. `OrgMember` gains the read-only `hasPassword`, since reads never return the password itself.

The password always travels as a client hash, never as plaintext: `lowercase_hex(SHA-256("vocdoni-member-password:" + canonicalAddress(orgAddress) + ":" + trim(password)))`, where `canonicalAddress` is `0x` plus the lowercase address without any `0x`. The `AuthRequest.password` JSDoc has the full rule and a test vector. Use the same value for `OrgMember.password` when setting a member's password and for `AuthRequest.password` when the member logs in.
