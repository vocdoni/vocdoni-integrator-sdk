# `@vocdoni/metadata-verify`

Checks election content against what its elections committed. Framework-agnostic (no React, no
i18n): every outcome is a structured code the app translates.

## Contract it relies on

- An election's `metadataHash` is the lowercase hex SHA-256 of the **exact bytes** served at its
  `metadataURL`. Ids and hashes compare case-insensitively and without `0x` (`normalizeHex`).
- A process is published as a **metadata-only parent election** (the process `upstreamId`) plus
  one election per question, each linked on chain to the parent (`parentElectionId`):
  - parent document: `title`/`description` = process text, `media.header`, `media.streamUri`,
    `meta.mediaHashes` (header only), `questions: []`;
  - question document: `title`/`description` = question text, `questions[0]` with
    `choices[{ title, value, meta: { description, image } }]`, `meta.mediaHashes` (choice images).
- Every vote carries both the question's and the parent's `metadataHash`, and the chain rejects
  it unless they are the current committed ones. So the hashes the SaaS API serves can be
  trusted for the voter check: a SaaS API serving other hashes cannot get the vote counted.
- Hash-checked media (`coverage: 'content'`): the header and choice images (`image` as a URL
  string or `{ default, thumbnail }`). The backend imports every image into SaaS storage at save
  time, so every one must be listed in `meta.mediaHashes`; an unlisted one is a `mismatch`
  (`reason: 'not-listed'`).
- URL-only media (`coverage: 'url-only'`): the video (`streamUri`) and images embedded in
  description markdown/HTML. Only their URL is covered, as part of the hashed text. They are
  never fetched.

## Live check: `verifyProcessMetadata`

```ts
import { verifyProcessMetadata } from '@vocdoni/metadata-verify'

// The process as the SaaS API returns it: process and questions carry
// upstreamId, metadataURL and metadataHash.
const result = await verifyProcessMetadata(process)
// options: { fetch?, maxBytes? (25 MiB), timeoutMs? }
// independent mode, reading hashes, URLs and parent links from the Vochain API instead:
// await verifyProcessMetadata(process, { independent: true, vochainApiUrl: 'https://api-dev.vocdoni.net/v2' })
```

The default mode makes **no Vochain API request**: it fetches each document from the
SaaS-provided `metadataURL` and compares its SHA-256 with the SaaS-provided `metadataHash`.
Never rejects. `ProcessVerification`:

| Field | Meaning |
|---|---|
| `status` | `'verified' \| 'mismatch' \| 'unverifiable' \| 'no-hash'` headline. Any mismatch wins; `verified` needs the parent and every question verified; a process without a parent (`reason: 'no-parent'`) does not hold it back; unverifiable media do not downgrade it. |
| `process` | Parent document check. `fields`: `process-title`, `process-description`, `header`, `stream`, plus `parent-link` in independent mode (every question election links to the parent on chain). |
| `documents[]` | One per published question (`upstreamId` set), in order. `fields`: `question-title`, `question-description`, `choices` (count), and per `choice` index `choice-title`, `choice-value`, `choice-description`, `choice-image` (URLs). |
| `media[]` | Hash-checked images: `{ url, coverage: 'content', committed, status, reason?, expectedHash?, actualHash?, bytes? }`. `bytes` (only when `verified`) are the exact verified bytes: render from them (blob URL), never re-request `url`. `committed` = a hash covers it, so it must verify before it is shown or a vote is cast. |
| `urlOnly[]` | `{ url, kind: 'stream' \| 'embedded', coverage: 'url-only', field, question?, choice?, status }`; `status` is that of the field whose text carries the URL. |

A document `mismatch` means the bytes differ from the hash **or** they match but the page shows
something else (`fields` then names what). `UnverifiableReason`: `chain-unavailable`
(independent mode), `unsupported-url`, `fetch-failed` (network, CORS, non-2xx, timeout),
`too-large`, `not-listed`, `no-parent`, `document-unverified`, `not-committed`.

Gating a vote is the app's policy, not the package's; the usual rule: block on `mismatch`, and on
any `committed` medium that is not `verified`; allow `no-hash` (published before hashes existed).

## History audit: `auditProcessMetadata` / `auditElectionMetadata`

The audit (organizer view, PDF report) reads the Vochain API.

```ts
import { auditProcessMetadata, diffWords, condenseDiff } from '@vocdoni/metadata-verify'

const audit = await auditProcessMetadata(processResponse, { vochainApiUrl })
// { parentElectionId, process, childrenAvailable, questions }
```

- The parent is the process `upstreamId` or, failing that, the `parentElectionId` a question
  election links to.
- Its metadata history (`GET /elections/{id}/metadata/history`) is audited first, then that of
  each child (`GET /elections/{id}/children`, oldest first, paginated: `getElectionChildren`),
  then of any process question the chain does not list as a child.
- Each `QuestionElectionAudit` adds `parentElectionId` (null = unreadable), `child`
  (null = children list unreadable), `inProcess` and `issues`: `wrong-parent` (links to another
  parent or none), `not-a-child` (a process question the chain does not list), `not-in-process`
  (a chain child the process does not show).
- Never rejects (`available: false` when a history cannot be read). Requests time out after 15 s
  by default (`DEFAULT_AUDIT_TIMEOUT_MS`).

Each `AuditedMetadataVersion`: `metadataURL`, `expectedHash?`, `actualHash?`, `status`
(`verified`, `mismatch`, `no-hash` = fetched but nothing recorded, `unverifiable` + `reason`),
`blockHeight` (0 = not located), `txHash?`, `timestamp` (`Date | null`), and `changes` against
the previous version (`null` for the first one or when either side is not trusted).
`MetadataChange.field`: `title`, `description`, `header`, `streamUri`, `headerContent`,
`choiceImageContent`, `mediaHash`, `questionTitle`, `questionDescription`, `choiceTitle`,
`choiceDescription`, `choiceImage` (per `variant`), `other` (anything else, once). Text changes
carry `lang`; render them with `condenseDiff(diffWords(before, after))`.

Helpers: `hasMetadataUpdates(audit)`, `hasIntegrityIssues(audit)`, `diffMetadata(before, after)`,
`normalizeHex`, `sha256Hex`.
