---
'@vocdoni/api-types': minor
'@vocdoni/api-client': minor
---

`OrgMember.weight` is now typed as a decimal `string` (e.g. `'2'`), matching what `POST` and `PUT /organizations/{address}/members` decode and what member reads return. It was typed as `number`, so `organizations.addMembers` and `organizations.upsertMember` sent a JSON number that the backend rejected with a 400, and setting a weight from TypeScript needed a cast. `OrgMember` also gains the write-only `password` field the backend accepts.

`organizations.upsertMember` now resolves to `UpsertOrgMemberResponse` (`{ id, censusJobIds?, errors? }`), which is what the route returns. It was typed as the member, but only `id` was ever set. `AddMembersResponse` gains `censusJobIds`.

**Why a minor.** The type corrections above are fixes: on their own they would be a patch. The bump is minor because this also adds public API surface: the new `UpsertOrgMemberResponse` type, and the `OrgMember.password` and `AddMembersResponse.censusJobIds` fields.

**Why not a major.** The corrections break compilation for some callers, but no working runtime behaviour:

- Writing a numeric weight already failed with a 400.
- Reading `weight` always returned a string, so code typed against `number` was reading a value the type misdescribed. Comparisons such as `(m.weight ?? 1) > 1` worked by coercion and now need `Number(m.weight)`. Arithmetic such as `m.weight + 1` concatenated strings and was already wrong.
- Of `upsertMember`'s result, only `id` was ever set, and it still is.

To migrate, write weights as decimal strings (`weight: 2` → `weight: '2'`), drop any `as unknown as number` cast, convert weights you read with `Number(...)`, and read only `id`/`censusJobIds`/`errors` from `upsertMember`.
