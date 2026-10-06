---
'@vocdoni/api-types': minor
---

`Choice` now declares `openValue?: boolean`, which marks the choice that collects free-text voter memos. `QuestionResults` (and so `VotingProcessQuestionResults`) declares `memos?: string[]`, the memos of the votes that selected that choice. The API returns them only to an org manager/admin or a `voting:write` API key, on a best-effort basis, and omits the field when it has none to return, so absence does not mean no memos were cast. The memos themselves are cleartext on-chain.
