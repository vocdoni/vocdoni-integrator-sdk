---
'@vocdoni/api-types': minor
---

Pay-per-process billing types: process quotes, checkouts, add-ons, wallet ledger and managed-org spend caps. `ApiErrorCode` names the billing error codes, and `ApiErrorDataByCode` types the `data` each one carries. `IntegratorLimits`, `IntegratorInfo.limits` and `IntegratorUsage.managedProcesses` are deprecated: saas-backend no longer returns them, and spending is bounded by the integrator's wallet and per-org spend caps.
