---
"@vocdoni/react-components": major
---

Adds the CSP voter identify flow: `<CspAuth />` renders an Identify button, a modal with the identify and one-time code steps, and a Logout button once connected. Certificate censuses (`census.certAuth`) are not handled: `<CspAuth />` renders nothing for them until the voter is connected by other means. `<CspAuth requireTerms />` enforces a terms acceptance checkbox. `<CspAuthSession />` shares one flow across several buttons. The flow is customizable through the `CspAuthTrigger`, `CspAuthLogout`, `CspAuthModal`, `CspAuthIdentifyForm` and `CspAuthCodeForm` slots. The member password is hashed with `hashMemberPassword` before it is sent.

Removes `SpreadsheetAccess`, a stub that rendered nothing, its `SpreadsheetAccess` slot, and the `spreadsheet.*` i18n keys. Adds the `csp.*` i18n block: custom slot overrides that read the old keys must move to `csp.*`.
