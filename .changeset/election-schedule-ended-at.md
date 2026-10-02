---
'@vocdoni/api-types': minor
'@vocdoni/react-components': minor
---

`ElectionSchedule` now shows the real end of a process that was ended early (`endedAt ?? endDate`), and the `ElectionResults` secret-until-the-end placeholder shows the real end of the secret questions. `endedAt` is typed on the process and on each question.
