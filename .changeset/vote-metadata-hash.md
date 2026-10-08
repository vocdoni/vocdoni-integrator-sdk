---
'@vocdoni/api-types': minor
'@vocdoni/api-voting': minor
'@vocdoni/api-client': minor
'@vocdoni/react-providers': minor
'@vocdoni/api-voting-zk': patch
---

Votes attest the election metadata hash. Question responses declare `metadataHash?: string` (lowercase hex SHA-256 of the question's metadata document) and `metadataURL?: string` (where that document is served), process responses declare the same two fields plus `upstreamId?: string` for the process's parent election (process-level text and media; not votable, so it never reaches a vote envelope), and `buildVoteTransaction` takes `metadataHash` and `parentMetadataHash` options that it puts on the vote envelope; the Vochain refuses a vote whose hashes differ from the question election's and its parent election's current ones. `ElectionProvider` passes each question's hash and the process's (parent) hash automatically and refetches the process when a vote is refused for stale metadata. `@vocdoni/api-client` adds `StaleMetadataError` (a `VocdoniApiError` thrown for the relay's 409 `ErrVoteMetadataChanged`, code 40904, exported as `VOTE_METADATA_CHANGED_CODE`) and `isStaleMetadataError()`, which also recognizes the chain's rejection on a failed vote job, so UIs can reload the ballot before the voter retries. `@vocdoni/proto` is bumped to 1.18.0, which carries `VoteEnvelope.parentMetadataHash`.
