---
"@vocdoni/api-client": patch
---

Ids interpolated into request paths are now percent-encoded, so an id containing `/`, `?` or `#` can no longer reach another endpoint. An empty, `.` or `..` id rejects with a `TypeError` before any request is sent.
