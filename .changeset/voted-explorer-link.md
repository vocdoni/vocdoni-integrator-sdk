---
"@vocdoni/react-providers": minor
"@vocdoni/react-components": patch
---

`ElectionProvider` takes an optional `explorerUrl` (block-explorer base URL) and `useElection()` exposes `explorerUrl`, defaulting to the explorer of the process's own `chainId` (`null` for an unknown chain). `Voted` now links each vote id to `{explorerUrl}/verify/{voteId}` instead of a relative link that led nowhere, renders it as plain text when no explorer is known, and passes the link to slot overrides as `VotedVote.url`.
