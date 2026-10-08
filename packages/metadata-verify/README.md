# @vocdoni/metadata-verify

Framework-agnostic verification of Vocdoni election metadata against the hashes committed on the
Vochain: one implementation for the voter view, the organizer view and the voting report.

## Purpose

The SaaS API serves its own copy of a process. The Vochain commits, per election, the SHA-256 of
its metadata document (`metadataHash`, lowercase hex of the exact bytes at `metadataURL`). This
package fetches those documents from the **Vochain API**, checks their hashes, and compares them
field by field with what a page shows. It has no runtime dependencies and uses WebCrypto and
`fetch` (injectable). Results are structured codes; the app supplies the wording.

## Public API

```typescript
// Live check of the content a page shows (a process as the SaaS API returns it).
verifyProcessMetadata(process: DisplayedProcess, options: VochainOptions): Promise<ProcessVerification>

// History audit: every metadata version, verified, diffed against the previous one.
auditProcessMetadata(process: AuditedProcess, options: VochainOptions): Promise<ProcessMetadataAudit>
auditElectionMetadata(electionId: string, options: VochainOptions): Promise<ElectionMetadataAudit>
getListedQuestionElections(audit): string[] | null
hasMetadataUpdates(audit): boolean
hasIntegrityIssues(audit): boolean

// Diffs.
diffMetadata(before: unknown, after: unknown): MetadataChange[]
diffWords(before: string, after: string): DiffSegment[]
condenseDiff(segments: DiffSegment[], contextWords?: number, ellipsis?: string): DiffSegment[]

// Primitives.
normalizeHex(value?: string | null): string | undefined
sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string>
MAX_VERIFIABLE_BYTES // 25 MiB
DEFAULT_AUDIT_TIMEOUT_MS // 15 s

interface VochainOptions {
  vochainApiUrl: string // e.g. https://api-dev.vocdoni.net/v2
  fetch?: FetchLike // defaults to globalThis.fetch
  maxBytes?: number
  timeoutMs?: number
}
```

Statuses are `HashCheck` (`'verified' | 'mismatch' | 'unverifiable' | 'no-hash'`) with an
`UnverifiableReason` when relevant. Only the header and choice images are hash-checked
(`coverage: 'content'`); their verified bytes are returned so they can be rendered from exactly
what was hashed. The video and images embedded in descriptions are covered by URL only
(`coverage: 'url-only'`, listed in `urlOnly`) and never fetched.

See `skills/vocdoni-integrator-sdk/references/metadata-verify.md` for the full result shapes.
