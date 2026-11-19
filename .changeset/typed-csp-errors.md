---
"@vocdoni/api-types": minor
---

`ApiErrorCode` gains the CSP voter codes `CensusParticipantNotFound` (40029), `CspAuthFailed` (40802), `VerificationMaxAttempts` (40017), `AttemptCooldown` (40103) and `ZeroWeightVoter` (40801), plus `InvalidData` (40037). `ApiErrorDataByCode` types their data, so `isApiError` narrows it: `RateLimitedData` (`retryAfter`, seconds) for 40017, `AttemptCooldownData` (`coolDownTime`, ms) for 40103, and `CensusValidationErrorData` (`memberIds`, `duplicates`, `missingData`, `notFound`) for the 40037 of `elections.validateCensus`.
