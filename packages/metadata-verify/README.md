# @vocdoni/metadata-verify

Framework-agnostic verification of Vocdoni election metadata against the hashes its elections
committed: one implementation for the voter view, the organizer view and the voting report.

## Purpose

A process is published as a metadata-only parent election plus one election per question,
linked to it on chain. Each commits the SHA-256 of its metadata document (`metadataHash`,
lowercase hex of the exact bytes at `metadataURL`), and every vote carries both the question's
and the parent's hash, which the chain checks. This package fetches those documents, checks
their hashes, and compares them field by field with what a page shows. It has no runtime
dependencies and uses WebCrypto and `fetch` (injectable). Results are structured codes; the app
supplies the wording.

## Public API

```typescript
// Live check of the content a page shows (a process as the SaaS API returns it, with
// metadataURL / metadataHash on the process and each question). No Vochain API request
// unless `independent: true`.
verifyProcessMetadata(process: DisplayedProcess, options?: VerifyOptions): Promise<ProcessVerification>

// History audit (reads the Vochain API): every metadata version of the parent and of each of
// its children, verified and diffed against the previous one, plus parent-link issues.
auditProcessMetadata(process: AuditedProcess, options: VochainOptions): Promise<ProcessMetadataAudit>
auditElectionMetadata(electionId: string, options: VochainOptions): Promise<ElectionMetadataAudit>
getElectionChildren(parentId: string, options: VochainOptions): Promise<Array<{ electionId: string; parentElectionId?: string }>>
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

type VerifyOptions = FetchOptions & ({ independent?: false } | { independent: true; vochainApiUrl: string })
interface VochainOptions extends FetchOptions {
  vochainApiUrl: string // e.g. https://api-dev.vocdoni.net/v2
}
interface FetchOptions {
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
