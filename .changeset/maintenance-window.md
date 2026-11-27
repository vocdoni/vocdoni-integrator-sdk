---
'@vocdoni/api-types': minor
'@vocdoni/api-client': minor
---

Support the scheduled maintenance window (vocdoni/saas-backend#872).

- `@vocdoni/api-types`: `InfoResponse` gains `maintenance?: { from: string; until: string }` (present until the window ends); `ApiErrorCode.Maintenance` (50304) is exported.
- `@vocdoni/api-client`: `VocdoniApiError.maintenance` carries the `X-Maintenance-Window` a refused write announced (`parseMaintenanceWindow` is exported too), next to the existing `retryAfterMs`. `jobs.waitFor` reads the window from every poll and, when it starts before the deadline, waits `timeoutMs` past its end, so jobs the backend holds through the window (votes relayed by `ElectionProvider` included) no longer time out. No option to pass.
