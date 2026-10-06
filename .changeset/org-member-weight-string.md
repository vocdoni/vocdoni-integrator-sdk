---
'@vocdoni/api-types': minor
'@vocdoni/api-client': minor
---

`OrgMember.weight` is now typed as a decimal `string` (e.g. `'2'`), matching what `POST` and `PUT /organizations/{address}/members` decode. It was typed as `number`, so `organizations.addMembers` and `organizations.upsertMember` sent a JSON number that the backend rejected with a 400; setting a weight from TypeScript needed a cast. Member reads already return the weight as a string.

**Why this is a minor and not a major.** Narrowing the type is nominally breaking, but every call that passed a number already failed at runtime, so no working code stops compiling. Replace a numeric weight with its decimal string (`weight: 2` → `weight: '2'`) and drop any `as unknown as number` cast.
