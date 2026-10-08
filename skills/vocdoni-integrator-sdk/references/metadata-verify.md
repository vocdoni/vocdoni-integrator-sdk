# `@vocdoni/metadata-verify`

Checks election content against what the Vochain committed. Framework-agnostic (no React, no
i18n): every outcome is a structured code the app translates. It is the one package that reads
the **Vochain API** (`/v2`) rather than the SaaS API, because the point is to not trust the SaaS
API's copy.

## Contract it relies on

- An election's `metadataHash` is the lowercase hex SHA-256 of the **exact bytes** served at its
  `metadataURL`. Ids and hashes compare case-insensitively and without `0x` (`normalizeHex`).
- A process is published as a **parent election** plus one election per question:
  - parent document: `title`/`description` = process text, `media.header`, `media.streamUri`,
    `meta.mediaHashes` (header only), `meta.questionElections` (question election ids, in order),
    `questions: []`;
  - question document: `title`/`description` = question text, `questions[0]` with
    `choices[{ title, value, meta: { description, image } }]`, `meta.mediaHashes` (choice images).
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

const process = await client.elections.get(processId) // as the SaaS API returns it
const result = await verifyProcessMetadata(process, {
  vochainApiUrl: 'https://api-dev.vocdoni.net/v2',
  // fetch?: injectable; maxBytes?: default 25 MiB; timeoutMs?: none by default
})
```

Never rejects. `ProcessVerification`:

| Field | Meaning |
|---|---|
| `status` | `'verified' \| 'mismatch' \| 'unverifiable' \| 'no-hash'` headline. Any mismatch wins; `verified` needs the parent and every question verified; a process without a parent (`reason: 'no-parent'`) does not hold it back; unverifiable media do not downgrade it. |
| `process` | Parent document check. `fields`: `organization`, `question-list`, `process-title`, `process-description`, `header`, `stream`. |
| `documents[]` | One per published question (`upstreamId` set), in order. `fields`: `question-title`, `question-description`, `choices` (count), and per `choice` index `choice-title`, `choice-value`, `choice-description`, `choice-image` (URLs). |
| `media[]` | Hash-checked images: `{ url, coverage: 'content', committed, status, reason?, expectedHash?, actualHash?, bytes? }`. `bytes` (only when `verified`) are the exact verified bytes: render from them (blob URL), never re-request `url`. `committed` = something on chain covers it, so it must verify before it is shown or a vote is cast. |
| `urlOnly[]` | `{ url, kind: 'stream' \| 'embedded', coverage: 'url-only', field, question?, choice?, status }`; `status` is that of the field whose text carries the URL. |

A document `mismatch` means the bytes differ from the hash **or** they match but the page shows
something else (`fields` then names what). `UnverifiableReason`: `chain-unavailable`,
`unsupported-url`, `fetch-failed` (network, CORS, non-2xx, timeout), `too-large`, `not-listed`,
`no-parent`, `document-unverified`, `not-committed`.

Gating a vote is the app's policy, not the package's; the usual rule: block on `mismatch`, and on
any `committed` medium that is not `verified`; allow `no-hash` (published before hashes existed).

## History audit: `auditProcessMetadata` / `auditElectionMetadata`

```ts
import { auditProcessMetadata, diffWords, condenseDiff } from '@vocdoni/metadata-verify'

const { process, questions } = await auditProcessMetadata(processResponse, { vochainApiUrl })
```

Reads `GET /elections/{id}/metadata/history` for the parent first, then the question elections
the parent lists (latest trusted version), then any process question it does not list. Never
rejects (`available: false` when a history cannot be read). Requests time out after 15 s by
default (`DEFAULT_AUDIT_TIMEOUT_MS`).

Each `AuditedMetadataVersion`: `metadataURL`, `expectedHash?`, `actualHash?`, `status`
(`verified`, `mismatch`, `no-hash` = fetched but nothing recorded, `unverifiable` + `reason`),
`blockHeight` (0 = not located), `txHash?`, `timestamp` (`Date | null`), `questionElections`, and
`changes` against the previous version (`null` for the first one or when either side is not
trusted). `MetadataChange.field`: `title`, `description`, `header`, `streamUri`, `headerContent`,
`choiceImageContent`, `mediaHash`, `questionElections`, `questionTitle`, `questionDescription`,
`choiceTitle`, `choiceDescription`, `choiceImage` (per `variant`), `other` (anything else, once).
Text changes carry `lang`; render them with `condenseDiff(diffWords(before, after))`.

Helpers: `getListedQuestionElections(audit)`, `hasMetadataUpdates(audit)`,
`hasIntegrityIssues(audit)`, `diffMetadata(before, after)`, `normalizeHex`, `sha256Hex`.
