---
'@vocdoni/api-client': minor
'@vocdoni/react-components': minor
---

Add `resolveEndDate(process)` (`endedAt ?? endDate`, ignoring an unparseable `endedAt` or one before `startDate`) and `questionsEndedAt(questions)` (the latest `endedAt` once every question has one) to `@vocdoni/api-client`, so consumers outside the React components can show when a vote really stopped. `ElectionSchedule` and `ElectionResults` now use them, and `@vocdoni/react-components` re-exports both. This adds `@vocdoni/api-client` (>= 2.4.0) as a peer dependency of `@vocdoni/react-components`; it is already required by `@vocdoni/react-providers`.
