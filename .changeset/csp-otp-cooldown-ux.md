---
"@vocdoni/api-types": minor
"@vocdoni/react-providers": minor
"@vocdoni/react-components": minor
---

CspAuth: add server-driven resend cooldown (40103 UX) and i18n for es/ca

- Adds `CspCooldownError` for 40103 responses; the UI shows a countdown notice and
  disables the resend button for the server-provided duration.
- Adds `resendDisabled` slot prop to `CspAuthCodeFormSlotProps` for custom UIs.
- Maps 40001 on the identify step to a generic unavailable message instead of raw
  backend text.
- Updates `resend_limit` and `code_rejected` message wording.
- Adds Spanish (es) and Catalan (ca) translations for the CSP section.
