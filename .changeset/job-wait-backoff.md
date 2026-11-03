---
"@vocdoni/api-client": minor
"@vocdoni/react-providers": patch
---

`jobs.waitFor` waits up to 5 minutes by default (was 60 s), backs off from `intervalMs` to the new `maxIntervalMs` option (default 5 s) with jitter, and retries transient poll failures (network errors, 429, 502, 503, 504) until the deadline. A relayed vote that waits more than a minute for its block is no longer reported as failed while it is still being included.
