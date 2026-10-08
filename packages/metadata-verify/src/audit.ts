/**
 * Audit of every metadata version an on-chain (Vochain) election has had.
 *
 * The chain does not store the document, only its URL and the SHA-256 of its exact bytes, once
 * for the version the election was created with and once per later metadata update. The Vochain
 * API lists those versions at `GET /elections/{electionId}/metadata/history`, oldest first. This
 * module fetches every version, checks its bytes against the recorded hash, and diffs each
 * version against the previous one field by field (see {@link diffMetadata}).
 */
import {
  type HashCheck,
  type UnverifiableReason,
  type VochainOptions,
  asArray,
  compareHash,
  electionPath,
  fetchBytes,
  fetchFailureReason,
  getVochainJson,
  isFetchableUrl,
  isRecord,
  normalizeHex,
  parseJson,
  readQuestionElections,
  sha256Hex,
} from './common'
import { type MetadataChange, diffMetadata } from './diff'

/** One entry of the Vochain API's metadata history, as served. */
export interface MetadataHistoryEntry {
  metadataURL?: string
  metadataHash?: string
  blockHeight?: number
  txIndex?: number
  txHash?: string
  timestamp?: string
}

export interface AuditedMetadataVersion {
  metadataURL: string
  /** The hash the chain recorded for this version, normalized; absent when it recorded none. */
  expectedHash?: string
  /** The hash of the fetched bytes; absent when they could not be fetched. */
  actualHash?: string
  /**
   * - `verified`: fetched, and its hash matches the recorded one;
   * - `mismatch`: fetched, but it is not the document that was recorded;
   * - `no-hash`: fetched, but the chain recorded no hash for it (elections created before
   *   hashes were recorded), so it cannot be verified; its content is still diffed;
   * - `unverifiable`: the document could not be fetched (see `reason`).
   */
  status: HashCheck
  reason?: UnverifiableReason
  /** 0 when the node could not locate the transaction that set this version. */
  blockHeight: number
  txHash?: string
  /** Null when the node reports no usable time. */
  timestamp: Date | null
  /**
   * Differences against the previous version: empty when the content shown to voters is the same,
   * null for the first version and whenever either side is unreadable or failed verification.
   */
  changes: MetadataChange[] | null
  /**
   * The question elections a parent election lists in `meta.questionElections`, in question
   * order, normalized. Null when the document does not list any or could not be trusted.
   */
  questionElections: string[] | null
}

export interface ElectionMetadataAudit {
  electionId: string
  /** False when the history itself could not be read, e.g. a Vochain API without the endpoint. */
  available: boolean
  versions: AuditedMetadataVersion[]
}

export interface ProcessMetadataAudit {
  /** The parent election's audit; null for a process published without one. */
  process: ElectionMetadataAudit | null
  /**
   * The question elections the parent lists (its latest trusted version), in that order, then any
   * question of the process it does not list, so a disagreement between the two shows.
   */
  questions: ElectionMetadataAudit[]
}

/** Per-request timeout when the caller sets none. */
export const DEFAULT_AUDIT_TIMEOUT_MS = 15_000

/** A Go zero time (year 1) or an unparsable string means the node did not know when it happened. */
const parseTimestamp = (value?: string): Date | null => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) || date.getUTCFullYear() <= 1 ? null : date
}

interface FetchedVersion {
  status: HashCheck
  reason?: UnverifiableReason
  actualHash?: string
  document: unknown
}

const fetchVersion = async (
  url: string,
  expectedHash: string | undefined,
  options: VochainOptions
): Promise<FetchedVersion> => {
  if (!isFetchableUrl(url)) return { status: 'unverifiable', reason: 'unsupported-url', document: undefined }
  let bytes: ArrayBuffer
  try {
    bytes = await fetchBytes(url, options)
  } catch (error) {
    return { status: 'unverifiable', reason: fetchFailureReason(error), document: undefined }
  }
  const actualHash = await sha256Hex(bytes)
  return { status: compareHash(actualHash, expectedHash), actualHash, document: parseJson(bytes) }
}

/** A version's content can be compared only when it was read, parsed, and did not fail its hash. */
const isComparable = (fetched: FetchedVersion) =>
  (fetched.status === 'verified' || fetched.status === 'no-hash') && isRecord(fetched.document)

/** Fetches, verifies and diffs the given history entries, oldest first. */
export const auditMetadataVersions = async (
  entries: MetadataHistoryEntry[],
  options: Omit<VochainOptions, 'vochainApiUrl'> = {}
): Promise<AuditedMetadataVersion[]> => {
  const resolved = { timeoutMs: DEFAULT_AUDIT_TIMEOUT_MS, ...options, vochainApiUrl: '' }
  const fetched = await Promise.all(
    entries.map((entry) => fetchVersion(entry.metadataURL ?? '', normalizeHex(entry.metadataHash), resolved))
  )

  return entries.map((entry, index): AuditedMetadataVersion => {
    const current = fetched[index]
    const previous = index > 0 ? fetched[index - 1] : undefined
    const comparable = isComparable(current)
    return {
      metadataURL: entry.metadataURL ?? '',
      expectedHash: normalizeHex(entry.metadataHash),
      actualHash: current.actualHash,
      status: current.status,
      ...(current.reason ? { reason: current.reason } : {}),
      blockHeight: entry.blockHeight ?? 0,
      txHash: normalizeHex(entry.txHash),
      timestamp: parseTimestamp(entry.timestamp),
      changes:
        previous && isComparable(previous) && comparable ? diffMetadata(previous.document, current.document) : null,
      questionElections: comparable ? readQuestionElections(current.document) : null,
    }
  })
}

/**
 * Reads an election's metadata history from the Vochain API and audits every version. Never
 * rejects: an unreadable history comes back as `available: false`. Requests time out after
 * {@link DEFAULT_AUDIT_TIMEOUT_MS} unless `timeoutMs` says otherwise.
 */
export const auditElectionMetadata = async (
  electionId: string,
  options: VochainOptions
): Promise<ElectionMetadataAudit> => {
  const resolved = { timeoutMs: DEFAULT_AUDIT_TIMEOUT_MS, ...options }
  const unavailable: ElectionMetadataAudit = { electionId, available: false, versions: [] }
  try {
    const body = await getVochainJson(`elections/${electionPath(electionId)}/metadata/history`, resolved)
    const entries = (isRecord(body) ? asArray(body.versions) : []).filter(isRecord) as MetadataHistoryEntry[]
    if (!entries.length) return unavailable
    return { electionId, available: true, versions: await auditMetadataVersions(entries, resolved) }
  } catch {
    return unavailable
  }
}

/**
 * The question elections listed by the latest trusted version of a parent election's metadata, or
 * null when no version lists them.
 */
export const getListedQuestionElections = (audit: ElectionMetadataAudit): string[] | null =>
  [...audit.versions].reverse().find((version) => version.questionElections !== null)?.questionElections ?? null

/** True when the election had at least one metadata update after the version it was created with. */
export const hasMetadataUpdates = (audit: ElectionMetadataAudit): boolean => audit.versions.length > 1

/** True when some version did not match its recorded hash or could not be fetched. */
export const hasIntegrityIssues = (audit: ElectionMetadataAudit): boolean =>
  audit.versions.some((version) => version.status === 'mismatch' || version.status === 'unverifiable')

/** The on-chain ids {@link auditProcessMetadata} reads: the parent's and its questions'. */
export interface AuditedProcess {
  upstreamId?: string
  questions?: Array<{ upstreamId?: string }>
}

/**
 * Audits a process: its parent election first, then the question elections the parent lists on
 * chain, then any question of the process the parent does not list. Never rejects.
 */
export const auditProcessMetadata = async (
  process: AuditedProcess,
  options: VochainOptions
): Promise<ProcessMetadataAudit> => {
  const processId = normalizeHex(process.upstreamId)
  const processAudit = processId ? await auditElectionMetadata(processId, options) : null
  const listed = (processAudit && getListedQuestionElections(processAudit)) ?? []
  const shown = (process.questions ?? []).map((question) => normalizeHex(question.upstreamId))
  const electionIds = [...new Set([...listed, ...shown])].filter((id): id is string => !!id && id !== processId)
  const questions = await Promise.all(electionIds.map((electionId) => auditElectionMetadata(electionId, options)))
  return { process: processAudit, questions }
}
