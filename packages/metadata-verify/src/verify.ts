/**
 * Check of what a page shows (the voter view, the organizer view) against what the Vochain
 * committed.
 *
 * A SaaS process is published as a metadata-only parent election, whose document carries the
 * process title, description and media, and one election per question, linked on chain to that
 * parent (`parentElectionId`), whose document carries that question and its choices. Images
 * are covered by `meta.mediaHashes`: the header by the parent document's, each choice image
 * (default and thumbnail) by its question document's. The backend imports and hashes every
 * image, so an image a verified document does not list is a mismatch. A video is never
 * hashed, nor is an image embedded in a description's markdown or HTML: only their URLs are
 * covered, as part of the hashed text (`urlOnly` in the result).
 *
 * By default the committed hashes and URLs are the ones the SaaS API serves, and the Vochain
 * API is not read at all: every vote carries both the question's and the parent's metadata
 * hash and the chain rejects it unless they are the committed ones, so a SaaS API serving other
 * hashes cannot get a vote counted for content the organizer did not commit. The `independent`
 * mode reads the hashes, URLs and parent links from the Vochain API instead.
 */
import {
  type FetchOptions,
  type HashCheck,
  type UnverifiableReason,
  asArray,
  asRecord,
  compareHash,
  electionPath,
  fetchBytes,
  fetchFailureReason,
  getVochainJson,
  imageVariants,
  isFetchableUrl,
  isRecord,
  normalizeHex,
  parseJson,
  readMediaHashes,
  sameHex,
  sha256Hex,
  toLanguageMap,
} from './common'

/** A piece of the content the page shows, compared with the verified metadata document. */
export type ContentField =
  | 'process-title'
  | 'process-description'
  | 'question-title'
  | 'question-description'
  /** The number of choices. */
  | 'choices'
  | 'choice-title'
  | 'choice-value'
  | 'choice-description'
  /** The choice's image URLs (default and thumbnail), not its bytes: those are checked as media. */
  | 'choice-image'
  | 'header'
  | 'stream'
  /**
   * Independent mode only: every question election links on chain to the process's parent
   * election (`parentElectionId`).
   */
  | 'parent-link'

export interface FieldCheck {
  field: ContentField
  /** Zero-based choice position, for the `choice-*` fields. */
  choice?: number
  status: Exclude<HashCheck, 'no-hash'>
}

export interface DocumentVerification {
  /** On-chain election id; absent for a process without a parent election. */
  electionId?: string
  metadataURL?: string
  /** The committed hash, normalized. */
  expectedHash?: string
  /** The hash of the bytes served at `metadataURL`. */
  actualHash?: string
  /**
   * `mismatch` either when the bytes differ from the committed hash, or when they match but
   * what the page shows differs from them (then `fields` names the differing pieces).
   */
  status: HashCheck
  reason?: UnverifiableReason
  /** Field-by-field comparison of the shown content with a hash-verified document. */
  fields?: FieldCheck[]
}

/** One displayed image, checked against the `meta.mediaHashes` of the document committing it. */
export interface MediaVerification {
  url: string
  coverage: 'content'
  /**
   * The image is committed on chain (its election has a metadata hash, or its process a
   * parent election), so it must verify before it is shown or a vote is cast.
   */
  committed: boolean
  expectedHash?: string
  actualHash?: string
  status: Exclude<HashCheck, 'no-hash'>
  reason?: UnverifiableReason
  /**
   * The exact bytes that matched `expectedHash`, present only when `verified`. Render the
   * image from these bytes (e.g. a blob URL), never from a second request to `url`, so what
   * is shown is what was verified.
   */
  bytes?: ArrayBuffer
}

/**
 * How much of a medium the chain covers:
 * - `content`: its bytes are hashed (header and choice images, see {@link MediaVerification});
 * - `url-only`: only its URL is, as part of a hashed document; its bytes are never fetched.
 */
export type MediaCoverage = 'content' | 'url-only'

/**
 * A medium covered by URL only: the video (`media.streamUri`) and images embedded in a
 * description's markdown or HTML. Its URL is as trustworthy as the text that carries it, so
 * `status` is that field's check; what the URL serves is not verified.
 */
export interface UrlOnlyMedium {
  url: string
  kind: 'stream' | 'embedded'
  coverage: 'url-only'
  /** The field whose text carries the URL: `stream`, or the description embedding it. */
  field: ContentField
  /** Zero-based position among the published questions, when a question's text carries it. */
  question?: number
  /** Zero-based choice position, for a choice description. */
  choice?: number
  status: Exclude<HashCheck, 'no-hash'>
}

export interface ProcessVerification {
  /** Headline: see {@link summarize}. */
  status: HashCheck
  /** The parent election's document: process title, description and media. */
  process: DocumentVerification
  /** One per published question, in the order shown. */
  documents: DocumentVerification[]
  /** Hash-checked images (`content` coverage): the header and every choice image. */
  media: MediaVerification[]
  /** Media covered by URL only; never fetched. */
  urlOnly: UrlOnlyMedium[]
}

/** Multi-language text as served by the SaaS API or written in a metadata document. */
export type LocalizedValue = string | Record<string, string | undefined> | null | undefined

export interface DisplayedChoice {
  title?: LocalizedValue
  value?: number
  meta?: { image?: unknown; description?: unknown }
}

export interface DisplayedQuestion {
  /** On-chain election id; questions without one are not published and are skipped. */
  upstreamId?: string
  /** URL of the question election's metadata document, as the SaaS API serves it. */
  metadataURL?: string
  /** SHA-256 the question election committed for that document, as the SaaS API serves it. */
  metadataHash?: string
  title?: LocalizedValue
  description?: LocalizedValue
  choices?: DisplayedChoice[]
}

/**
 * What the page renders, as the SaaS API returns it (`GET /processes/{id}`, with choice
 * `meta` folded in as `@vocdoni/api-client` does).
 */
export interface DisplayedProcess {
  /** On-chain id of the parent election; absent for processes published without one. */
  upstreamId?: string
  /** URL of the parent election's metadata document, as the SaaS API serves it. */
  metadataURL?: string
  /** SHA-256 the parent election committed for that document, as the SaaS API serves it. */
  metadataHash?: string
  title?: LocalizedValue
  description?: LocalizedValue
  header?: string
  streamUri?: string
  questions?: DisplayedQuestion[]
}

/** Options of {@link verifyProcessMetadata}. */
export type VerifyOptions = FetchOptions &
  (
    | {
        /** Reads the committed hashes from the SaaS-provided content (default); the Vochain API is not used. */
        independent?: false
        vochainApiUrl?: string
      }
    | {
        /** Reads the committed hashes, URLs and parent links from the Vochain API instead of the SaaS API. */
        independent: true
        vochainApiUrl: string
      }
  )

/** An election's commitment: the metadata document's URL and hash, and its parent link. */
export interface ChainElectionInfo {
  organizationId?: string
  metadataURL?: string
  metadataHash?: string
  /** The metadata-only election this one links to as its parent. */
  parentElectionId?: string
  metadataOnly?: boolean
}

/** Reads an election's commitment from the Vochain API (`GET /elections/{electionId}`). */
export const getChainElection = async (
  electionId: string,
  options: FetchOptions & { vochainApiUrl: string }
): Promise<ChainElectionInfo> => {
  const body = asRecord(await getVochainJson(`elections/${electionPath(electionId)}`, options))
  const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
  return {
    organizationId: text(body.organizationId),
    metadataURL: text(body.metadataURL),
    metadataHash: text(body.metadataHash),
    parentElectionId: text(body.parentElectionId),
    metadataOnly: body.metadataOnly === true,
  }
}

/**
 * True when the shown text matches the document's in every language the document has. A
 * document without the text matches only a page that shows none either.
 */
export const localizedMatches = (shown: unknown, documented: unknown): boolean => {
  const doc = toLanguageMap(documented)
  const page = toLanguageMap(shown)
  const languages = Object.keys(doc)
  if (languages.length === 0) return Object.keys(page).length === 0
  return languages.every((language) => page[language] === doc[language])
}

const sameText = (shown: unknown, documented: unknown) =>
  (typeof shown === 'string' ? shown : '') === (typeof documented === 'string' ? documented : '')

const sameImages = (shown: unknown, documented: unknown) => {
  const a = imageVariants(shown)
  const b = imageVariants(documented)
  const variants = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...variants].every((variant) => a[variant] === b[variant])
}

const check = (field: ContentField, matches: boolean, choice?: number): FieldCheck => ({
  field,
  ...(choice === undefined ? {} : { choice }),
  status: matches ? 'verified' : 'mismatch',
})

/** Process-level fields: what the parent election's document vouches for. */
const PROCESS_FIELDS: ContentField[] = ['process-title', 'process-description', 'header', 'stream']

/**
 * Compares the process-level content the page shows (title, description, header, stream)
 * with the parent election's hash-verified metadata document.
 */
export const compareProcessContent = (process: DisplayedProcess, metadata: unknown): FieldCheck[] => {
  const doc = asRecord(metadata)
  const media = asRecord(doc.media)
  return [
    check('process-title', localizedMatches(process.title, doc.title)),
    check('process-description', localizedMatches(process.description, doc.description)),
    check('header', sameText(process.header, media.header)),
    check('stream', sameText(process.streamUri, media.streamUri)),
  ]
}

/**
 * Compares one question as the page shows it (title, description, and each choice by
 * position: title, value, description and image URLs) with that question's hash-verified
 * metadata document, whose `questions[0].choices[i].meta` carries the choice's description
 * and image.
 */
export const compareQuestionContent = (question: DisplayedQuestion, metadata: unknown): FieldCheck[] => {
  const docQuestion = asRecord(asArray(asRecord(metadata).questions)[0])
  const docChoices = asArray(docQuestion.choices)
  const shownChoices = question.choices ?? []

  const fields: FieldCheck[] = [
    check('question-title', localizedMatches(question.title, docQuestion.title)),
    check('question-description', localizedMatches(question.description, docQuestion.description)),
    check('choices', shownChoices.length === docChoices.length),
  ]
  shownChoices.forEach((choice, index) => {
    const docChoice = docChoices[index]
    if (!isRecord(docChoice)) {
      fields.push(
        check('choice-title', false, index),
        check('choice-value', false, index),
        check('choice-description', false, index),
        check('choice-image', false, index)
      )
      return
    }
    const docMeta = asRecord(docChoice.meta)
    fields.push(
      check('choice-title', localizedMatches(choice.title, docChoice.title), index),
      check('choice-value', choice.value === docChoice.value, index),
      check('choice-description', localizedMatches(choice.meta?.description, docMeta.description), index),
      check('choice-image', sameImages(choice.meta?.image, docMeta.image), index)
    )
  })
  return fields
}

/**
 * Worst outcome wins. Documents decide the headline: all verified → verified, all without a
 * committed hash → no-hash, anything else → unverifiable. A process published without a
 * parent election (`no-parent`) does not hold back a verified headline: its process-level
 * fields are listed as not verifiable instead. A media mismatch overrides it all, but
 * unverifiable media do not: callers decide what an unverifiable committed image means
 * (see {@link MediaVerification.committed}).
 */
export const summarize = (
  process: DocumentVerification,
  documents: DocumentVerification[],
  media: MediaVerification[]
): HashCheck => {
  const all = process.reason === 'no-parent' ? documents : [process, ...documents]
  if (all.some((d) => d.status === 'mismatch') || media.some((m) => m.status === 'mismatch')) return 'mismatch'
  if (documents.length > 0 && all.every((d) => d.status === 'verified')) return 'verified'
  if (documents.length > 0 && all.every((d) => d.status === 'no-hash')) return 'no-hash'
  return 'unverifiable'
}

interface FetchedDocument {
  verification: DocumentVerification
  /** The election commits a metadata hash, and with it the images its document lists. */
  committed: boolean
  /** Independent mode: the parent the chain links the election to; null when the chain could not be read. */
  parentElectionId?: string | null
  /** Parsed document (null when not JSON), only when its bytes match the committed hash. */
  metadata?: unknown
}

/**
 * Resolves an election's commitment (from the SaaS-provided `shown` fields, or from the chain in
 * independent mode) and hash-checks the metadata document it commits.
 */
const fetchDocument = async (
  electionId: string,
  shown: { metadataURL?: string; metadataHash?: string },
  options: VerifyOptions
): Promise<FetchedDocument> => {
  let info: ChainElectionInfo = shown
  if (options.independent) {
    try {
      info = await getChainElection(electionId, options)
    } catch {
      // Unknown whether it commits anything: treat it as committing, so nothing passes unchecked.
      return {
        verification: { electionId, status: 'unverifiable', reason: 'chain-unavailable' },
        committed: true,
        parentElectionId: null,
      }
    }
  }
  return checkDocument(electionId, info, options)
}

const checkDocument = async (
  electionId: string,
  info: ChainElectionInfo,
  options: FetchOptions
): Promise<FetchedDocument> => {
  const { metadataURL } = info
  const linked = { parentElectionId: normalizeHex(info.parentElectionId) }
  const expectedHash = normalizeHex(info.metadataHash)
  const base = { electionId, metadataURL, expectedHash }

  if (!expectedHash) return { verification: { ...base, status: 'no-hash' }, committed: false, ...linked }
  if (!isFetchableUrl(metadataURL)) {
    return {
      verification: { ...base, status: 'unverifiable', reason: 'unsupported-url' },
      committed: true,
      ...linked,
    }
  }

  let bytes: ArrayBuffer
  try {
    bytes = await fetchBytes(metadataURL, options)
  } catch (error) {
    return {
      verification: { ...base, status: 'unverifiable', reason: fetchFailureReason(error) },
      committed: true,
      ...linked,
    }
  }

  const actualHash = await sha256Hex(bytes)
  const status = compareHash(actualHash, expectedHash)
  // Content and media hashes are only as trustworthy as the document carrying them: read
  // them from a document the chain vouches for, never from one that failed the check.
  return {
    verification: { ...base, actualHash, status },
    committed: true,
    ...linked,
    // A verified document that is not valid JSON still gets compared (as an empty one), so
    // the page cannot pass as verified against content nobody can read.
    metadata: status === 'verified' ? (parseJson(bytes) ?? null) : undefined,
  }
}

/**
 * Applies a field comparison to a hash-verified document. The page renders the SaaS API's
 * copy of the content, not the document: a matching hash proves nothing about the screen
 * until the two are compared field by field.
 */
const withFields = (verification: DocumentVerification, fields: FieldCheck[]): DocumentVerification => ({
  ...verification,
  status: fields.some((field) => field.status === 'mismatch') ? 'mismatch' : verification.status,
  fields,
})

/** Checks one image against the document that commits it (`source`, absent when there is none). */
const verifyImage = async (
  url: string,
  source: FetchedDocument | undefined,
  options: FetchOptions
): Promise<MediaVerification> => ({ coverage: 'content', ...(await checkImage(url, source, options)) })

const checkImage = async (
  url: string,
  source: FetchedDocument | undefined,
  options: FetchOptions
): Promise<Omit<MediaVerification, 'coverage'>> => {
  if (!source) return { url, committed: false, status: 'unverifiable', reason: 'no-parent' }
  if (!source.committed) return { url, committed: false, status: 'unverifiable', reason: 'not-committed' }
  if (source.metadata === undefined) {
    return { url, committed: true, status: 'unverifiable', reason: 'document-unverified' }
  }

  // The backend hashes every image it publishes: one a verified document does not list was
  // not committed by the organizer.
  const expectedHash = readMediaHashes(source.metadata)[url]
  if (!expectedHash) return { url, committed: true, status: 'mismatch', reason: 'not-listed' }
  if (!isFetchableUrl(url)) {
    return { url, committed: true, expectedHash, status: 'unverifiable', reason: 'unsupported-url' }
  }

  let bytes: ArrayBuffer
  try {
    bytes = await fetchBytes(url, options)
  } catch (error) {
    // CORS failures land here too: the browser hides the bytes, so the image can't be checked.
    return { url, committed: true, expectedHash, status: 'unverifiable', reason: fetchFailureReason(error) }
  }

  const actualHash = await sha256Hex(bytes)
  return compareHash(actualHash, expectedHash) === 'verified'
    ? { url, committed: true, expectedHash, actualHash, status: 'verified', bytes }
    : { url, committed: true, expectedHash, actualHash, status: 'mismatch' }
}

/**
 * The images the page shows, with the published question committing each (none for the
 * header, which the parent commits): the header and every choice image, default and
 * thumbnail, as written (results are keyed by the same string). The video is not one: its
 * content is never hashed. A URL shown more than once is checked once, against its first
 * occurrence.
 */
export const displayedImages = (process: DisplayedProcess): Array<{ url: string; question?: DisplayedQuestion }> => {
  const images: Array<{ url: string; question?: DisplayedQuestion }> = []
  const seen = new Set<string>()
  const push = (value: unknown, question?: DisplayedQuestion) => {
    if (typeof value !== 'string' || !value.trim() || seen.has(value)) return
    seen.add(value)
    images.push({ url: value, question })
  }

  push(process.header)
  for (const question of process.questions ?? []) {
    // Drafts are not on chain: nothing commits their images.
    if (!question.upstreamId) continue
    for (const choice of question.choices ?? []) {
      const { default: image, thumbnail } = imageVariants(choice.meta?.image)
      push(image, question)
      push(thumbnail, question)
    }
  }

  return images
}

// Markdown `![alt](url "title")` and HTML `<img src="url">`.
const EMBEDDED_IMAGE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)|<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi

/** URLs of the images embedded in a text's markdown or HTML, in any language, once each. */
export const embeddedImageUrls = (text: unknown): string[] => {
  const urls = new Set<string>()
  for (const value of Object.values(toLanguageMap(text))) {
    for (const match of value.matchAll(EMBEDDED_IMAGE)) {
      const url = match[1] ?? match[2]
      if (url) urls.add(url)
    }
  }
  return [...urls]
}

const fieldStatus = (document: DocumentVerification, field: ContentField, choice?: number) =>
  document.fields?.find((f) => f.field === field && f.choice === choice)?.status ?? 'unverifiable'

/** The media the page shows that only their URL covers, with the status of the text carrying it. */
const urlOnlyMedia = (
  process: DisplayedProcess,
  processVerification: DocumentVerification,
  published: DisplayedQuestion[],
  documents: DocumentVerification[]
): UrlOnlyMedium[] => {
  const media: UrlOnlyMedium[] = []
  const add = (
    url: string,
    kind: UrlOnlyMedium['kind'],
    field: ContentField,
    document: DocumentVerification,
    position: { question?: number; choice?: number } = {}
  ) => {
    const status = fieldStatus(document, field, position.choice)
    media.push({ url, kind, coverage: 'url-only', field, ...position, status })
  }

  if (process.streamUri) add(process.streamUri, 'stream', 'stream', processVerification)
  for (const url of embeddedImageUrls(process.description)) {
    add(url, 'embedded', 'process-description', processVerification)
  }
  published.forEach((question, index) => {
    for (const url of embeddedImageUrls(question.description)) {
      add(url, 'embedded', 'question-description', documents[index], { question: index })
    }
    question.choices?.forEach((choice, choiceIndex) => {
      for (const url of embeddedImageUrls(choice.meta?.description)) {
        add(url, 'embedded', 'choice-description', documents[index], { question: index, choice: choiceIndex })
      }
    })
  })
  return media
}

/**
 * Verifies a process as the page shows it against what its elections committed:
 *
 * - the parent election (the process's own `upstreamId`) commits the process-level document:
 *   title, description, header, stream and the header's hash. A process published without one
 *   leaves those fields not verifiable;
 * - each published question's election commits that question's document: title,
 *   description and choices (title, value, description, image URLs);
 * - each displayed image is hashed against the `meta.mediaHashes` of the document that
 *   commits it: the header against the parent's, a choice image against its question's;
 * - the video and images embedded in descriptions are covered by URL only, as part of the
 *   document carrying them, and listed in `urlOnly`; they are never fetched.
 *
 * The committed URLs and hashes are the SaaS-provided `metadataURL` / `metadataHash` of the
 * process and of each question, and the Vochain API is not read. With `independent: true` they
 * are read from the Vochain API instead, which also checks that every question election links
 * to the parent (`parent-link`).
 *
 * Never rejects: chain and network failures come back as `unverifiable` with a reason.
 */
export const verifyProcessMetadata = async (
  process: DisplayedProcess,
  options: VerifyOptions = {}
): Promise<ProcessVerification> => {
  const published = (process.questions ?? []).filter(
    (question): question is DisplayedQuestion & { upstreamId: string } => !!question.upstreamId
  )

  const [parent, questions] = await Promise.all([
    process.upstreamId ? fetchDocument(process.upstreamId, process, options) : Promise.resolve(undefined),
    Promise.all(published.map((question) => fetchDocument(question.upstreamId, question, options))),
  ])

  const documents = questions.map(({ verification, metadata }, index) =>
    metadata === undefined ? verification : withFields(verification, compareQuestionContent(published[index], metadata))
  )

  let processVerification: DocumentVerification
  if (!parent || !process.upstreamId) {
    processVerification = {
      status: 'unverifiable',
      reason: 'no-parent',
      fields: PROCESS_FIELDS.map((field): FieldCheck => ({ field, status: 'unverifiable' })),
    }
  } else {
    const parentId = process.upstreamId
    const links = questions.map((question) => question.parentElectionId)
    // The chain refuses a vote whose parent hash is not the linked parent's, so in the default
    // mode the link is enforced through the vote; only the independent mode reads it.
    const linkFields: FieldCheck[] = !options.independent
      ? []
      : links.length === 0 || links.some((link) => link === null)
        ? [{ field: 'parent-link', status: 'unverifiable' }]
        : [check('parent-link', links.every((link) => sameHex(link, parentId)))]
    const fields = [
      ...linkFields,
      ...(parent.metadata === undefined ? [] : compareProcessContent(process, parent.metadata)),
    ]
    processVerification = fields.length ? withFields(parent.verification, fields) : parent.verification
  }

  const sourceOf = new Map<DisplayedQuestion, FetchedDocument>(
    published.map((question, index) => [question, questions[index]])
  )
  const media = await Promise.all(
    displayedImages(process).map(({ url, question }) =>
      verifyImage(url, question ? sourceOf.get(question) : parent, options)
    )
  )

  return {
    status: summarize(processVerification, documents, media),
    process: processVerification,
    documents,
    media,
    urlOnly: urlOnlyMedia(process, processVerification, published, documents),
  }
}
