---
'@vocdoni/react-components': patch
---

Default slots now render descriptions as plain text instead of injecting them as HTML, fixing a stored XSS where election, question, choice and organization metadata could run script. Markdown or HTML in those descriptions now shows as literal text; override the slot to render it, with sanitization.
