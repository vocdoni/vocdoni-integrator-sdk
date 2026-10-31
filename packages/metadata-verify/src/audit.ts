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
  sameHex,
  sha256Hex,
} from './common'
import { type MetadataChange, diffMetadata } from './diff'
import { getChainElection } from './verify'

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
}

export interface ElectionMetadataAudit {
  electionId: string
  /** False when the history itself could not be read, e.g. a Vochain API without the endpoint. */
  available: boolean
  versions: AuditedMetadataVersion[]
}

/** How a question election's on-chain link disagrees with the process. */
export type QuestionLinkIssue =
  /** The chain links the election to another parent than the process's, or to none. */
  | 'wrong-parent'
  /** A question of the process that the chain does not list among the parent's children. */
  | 'not-a-child'
  /** A child of the parent on chain that the process does not show. */
  | 'not-in-process'

export interface QuestionElectionAudit extends ElectionMetadataAudit {
  /**
   * The parent the chain links the election to, normalized; absent when it links to none, null
   * when the chain could not be read.
   */
  parentElectionId?: string | null
  /** Listed among the parent's children on chain; null when that list could not be read. */
  child: boolean | null
  /** One of the process's questions. */
  inProcess: boolean
  issues: QuestionLinkIssue[]
}

export interface ProcessMetadataAudit {
  /**
   * The parent election: the process's `upstreamId` or, failing that, the parent a question
   * election links to on chain. Null when there is none.
   */
  parentElectionId: string | null
  /** The parent election's audit; null without a parent. */
  process: ElectionMetadataAudit | null
  /** False when the parent's children could not be read from the chain (or there is no parent). */
  childrenAvailable: boolean
  /**
   * The parent's children on chain, oldest first, then any question of the process the chain does
   * not list as one, so a disagreement between the two shows.
   */
  questions: QuestionElectionAudit[]
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

/** Page size for `GET /elections/{id}/children`: the Vochain API's maximum. */
const CHILDREN_PAGE_SIZE = 100
/** Upper bound on the pages read, so a misbehaving API cannot keep the audit looping. */
const MAX_CHILDREN_PAGES = 100

/**
 * The elections linked to `parentId` as their parent, oldest first, with the parent each one
 * reports (normalized), read page by page from `GET /elections/{electionId}/children`.
 */
export const getElectionChildren = async (
  parentId: string,
  options: VochainOptions
): Promise<Array<{ electionId: string; parentElectionId?: string }>> => {
  const children: Array<{ electionId: string; parentElectionId?: string }> = []
  for (let page = 0; page < MAX_CHILDREN_PAGES; page++) {
    const body = await getVochainJson(
      `elections/${electionPath(parentId)}/children?page=${page}&limit=${CHILDREN_PAGE_SIZE}`,
      options
    )
    if (!isRecord(body)) throw new Error('unexpected children response')
    const elections = asArray(body.elections).filter(isRecord)
    for (const election of elections) {
      const electionId = normalizeHex(typeof election.electionId === 'string' ? election.electionId : undefined)
      const parentElectionId =
        typeof election.parentElectionId === 'string' ? normalizeHex(election.parentElectionId) : undefined
      if (electionId) children.push({ electionId, ...(parentElectionId ? { parentElectionId } : {}) })
    }
    const nextPage = isRecord(body.pagination) ? body.pagination.nextPage : undefined
    if (typeof nextPage !== 'number' || nextPage <= page || elections.length === 0) break
    page = nextPage - 1
  }
  return children
}

/** The parent an election links to on chain: absent for none, null when the chain could not be read. */
const readParentLink = async (electionId: string, options: VochainOptions): Promise<string | null | undefined> => {
  try {
    return normalizeHex((await getChainElection(electionId, options)).parentElectionId)
  } catch {
    return null
  }
}

/**
 * Audits a process: the metadata history of its parent election first, then that of each of the
 * parent's children on chain (`GET /elections/{id}/children`, oldest first), then of any question
 * of the process the chain does not list as a child. Each question election reports how its
 * on-chain link disagrees with the process (`issues`). The parent is the process's `upstreamId`
 * or, failing that, the `parentElectionId` a question election links to. Never rejects.
 */
export const auditProcessMetadata = async (
  process: AuditedProcess,
  options: VochainOptions
): Promise<ProcessMetadataAudit> => {
  const resolved = { timeoutMs: DEFAULT_AUDIT_TIMEOUT_MS, ...options }
  const shown = [
    ...new Set(
      (process.questions ?? []).map((question) => normalizeHex(question.upstreamId)).filter((id): id is string => !!id)
    ),
  ]

  const links = new Map<string, string | null | undefined>()
  let parentId = normalizeHex(process.upstreamId) ?? null
  if (!parentId) {
    for (const id of shown) {
      const link = await readParentLink(id, resolved)
      links.set(id, link)
      if (link) {
        parentId = link
        break
      }
    }
  }

  const [processAudit, children] = await Promise.all([
    parentId ? auditElectionMetadata(parentId, resolved) : Promise.resolve(null),
    parentId ? getElectionChildren(parentId, resolved).catch(() => null) : Promise.resolve(null),
  ])
  for (const child of children ?? []) links.set(child.electionId, child.parentElectionId)

  const childIds = new Set((children ?? []).map((child) => child.electionId))
  const electionIds = [...new Set([...childIds, ...shown])].filter((id) => id !== parentId)
  const questions = await Promise.all(
    electionIds.map(async (electionId): Promise<QuestionElectionAudit> => {
      const [audit, parentElectionId] = await Promise.all([
        auditElectionMetadata(electionId, resolved),
        links.has(electionId) ? links.get(electionId) : readParentLink(electionId, resolved),
      ])
      const child = children ? childIds.has(electionId) : null
      const inProcess = shown.includes(electionId)
      const issues: QuestionLinkIssue[] = []
      if (parentId && parentElectionId !== null && !sameHex(parentElectionId, parentId)) issues.push('wrong-parent')
      if (child === false && inProcess) issues.push('not-a-child')
      if (child && !inProcess) issues.push('not-in-process')
      return { ...audit, parentElectionId, child, inProcess, issues }
    })
  )

  return { parentElectionId: parentId, process: processAudit, childrenAvailable: !!children, questions }
}
