---
'@vocdoni/api-client': minor
'@vocdoni/react-components': patch
---

Add `resolveEndDate(process)` (`endedAt ?? endDate`, ignoring an unparseable `endedAt`) and `questionsEndedAt(questions)` (the latest `endedAt` once every question has one) to `@vocdoni/api-client`, so consumers outside the React components can show when a vote really stopped. `ElectionSchedule` and `ElectionResults` now use them, which adds `@vocdoni/api-client` as a peer dependency of `@vocdoni/react-components` (already required by `@vocdoni/react-providers`).
