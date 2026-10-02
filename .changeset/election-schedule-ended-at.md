---
'@vocdoni/api-types': minor
'@vocdoni/react-components': patch
---

`ElectionSchedule` now shows the real end of a process that was ended early (`endedAt ?? endDate`), and `endedAt` is typed on the process response.
