// ─── Auth ────────────────────────────────────────────────────────────────────

/**
 * Response of `POST /auth/login` and `POST /auth/refresh`. The JWT plus its
 * expiry; there is no refresh token — `refresh()` re-issues using the current
 * token. `expirity` mirrors the API's (misspelled) field name.
 */
export interface AuthToken {
  token: string
  expirity: string
}

export interface JWTPayload {
  sub: string
  iat: number
  exp: number
}

// ─── Organization ─────────────────────────────────────────────────────────────

/**
 * Locale-keyed text, e.g. `{ default: 'Acme', es: 'Acme SA' }`. The SaaS API
 * stores an organization's `name` / `description` / `logo` (shorthands for the
 * matching `meta[...]` keys) this way; the `default` key is the fallback locale.
 */
export type MultilingualText = Record<string, string>

/**
 * The full organization record the SaaS API returns from
 * `GET /organizations/{address}` — the `apicommon.OrganizationInfo` schema. The
 * API marks no field as required and omits absent ones, so everything past
 * `address` is optional.
 */
export interface Organization {
  /**
   * Organization address as a hex string. The swagger models this as a byte
   * array (`[]integer`), but the JSON the client sends and receives is the hex
   * string form, so it is typed as `string` here.
   */
  address: string
  /** Shorthand for `meta["name"]`; a locale map on read. */
  name?: MultilingualText
  /** Shorthand for `meta["description"]`; a locale map on read. */
  description?: MultilingualText
  /** Shorthand for `meta["logo"]`; a locale map on read. */
  logo?: MultilingualText
  website?: string
  /** Brand color in hex format. */
  color?: string
  /** Size category of the organization. */
  size?: string
  /** Organization type (see `GET /organizations/types`). */
  type?: string
  country?: string
  timezone?: string
  subdomain?: string
  communications?: boolean
  /** Whether this org is subscribed to the (free) integrator plan. */
  integrator?: boolean
  /** Creation timestamp, RFC3339. */
  createdAt?: string
  /**
   * Integrator org (hex) that manages this org; absent for regular orgs. Lets
   * clients tell managed orgs apart from the user's own orgs.
   */
  managedBy?: string
  /** Arbitrary metadata; `name` / `description` / `logo` mirror `meta[...]`. */
  meta?: Record<string, unknown>
  /** Usage counters for the organization. */
  counters?: SubscriptionUsage
  /** Subscription details for the organization. */
  subscription?: SubscriptionDetails
  /** Parent organization when this is a sub-organization. */
  parent?: Organization
}

/**
 * Body of `POST /organizations` (and, as a `Partial`, `PUT /organizations/{address}`).
 * Mirrors the SaaS `apicommon.CreateOrganizationRequest`: the write shape of
 * {@link Organization} plus `provisionAccount`. On write, `name` / `description` /
 * `logo` accept a plain string (stored as `{ default: value }`) or a locale map.
 */
export interface CreateOrganizationRequest {
  name: string | MultilingualText
  description?: string | MultilingualText
  logo?: string | MultilingualText
  website?: string
  color?: string
  size?: string
  type?: string
  country?: string
  timezone?: string
  subdomain?: string
  communications?: boolean
  /** Opt-in to the free integrator plan at creation. */
  integrator?: boolean
  meta?: Record<string, unknown>
  /** Opt-in to eagerly provision the on-chain account at creation (default false). */
  provisionAccount?: boolean
}

/** Effective managed-resource quota for an integrator. A 0 in any field means unlimited. */
export interface IntegratorLimits {
  maxManagedOrgs: number
  maxManagedProcesses: number
  maxVotes: number
  maxSMS: number
  maxEmails: number
}

export interface IntegratorUsage {
  managedOrgs: number
  managedProcesses: number
  sentVotes: number
  sentSMS: number
  sentEmails: number
}

/** Response of `GET /integrator`. */
export interface IntegratorInfo {
  enabled: boolean
  /** Omitted when `enabled` is false (the org is not an integrator). */
  limits?: IntegratorLimits
  usage: IntegratorUsage
}

// ─── Census ───────────────────────────────────────────────────────────────────

// How census members are sourced — determines how the backend creates the census.
// The backend derives the Vochain census protocol type from this + election options.
export type CensusSource = 'spreadsheet' | 'web3' | 'csp'

export interface Census {
  id: string
  source: CensusSource
  size: number
  uri?: string
}

/**
 * The richer SaaS census-management shape carried by a process.
 * Distinct from the voting-time {@link Census}: this describes how voters
 * authenticate (`authFields` / `twoFaFields`) and the census `type`, which is
 * what a login form needs. An empty/absent `twoFaFields` means an auth-only
 * census (step 0 already returns a verified token, no OTP).
 */
export interface CensusInfo {
  id?: string
  /** SaaS census auth type, e.g. "csp", "sms" — not a {@link CensusSource}. */
  type?: string
  /** Whether votes are weighted by the census. */
  weighted?: boolean
  size?: number
  /** Published census URI (from `published.uri`). */
  uri?: string
  /** Identity fields the voter must supply at auth step 0. */
  authFields?: string[]
  /** 2FA contact fields; empty/absent ⇒ auth-only census. */
  twoFaFields?: string[]
}

/**
 * Member-data fields a CSP census can authenticate on. Listed at census
 * creation / group publish; an auth-only census (no 2FA) is one with only
 * `authFields` set.
 */
export type OrgMemberAuthField = 'name' | 'surname' | 'memberNumber' | 'nationalId' | 'birthDate'
/** Contact fields used for the 2FA OTP challenge. */
export type OrgMemberTwoFaField = 'email' | 'phone'

/** Body of `POST /census` — creates an (empty) org-level CSP census. */
export interface CreateCensusRequest {
  orgAddress: string
  authFields?: OrgMemberAuthField[]
  twoFaFields?: OrgMemberTwoFaField[]
}

/** Response of `POST /census` — only the new census id (as `id`). */
export interface CreateCensusResponse {
  id: string
}

/** The SaaS census record returned by `GET /census/{id}`. */
export interface OrganizationCensus {
  censusId: string
  type?: string
  orgAddress: string
  size?: number
  weighted?: boolean
  /**
   * Source member group, absent for org-wide censuses. Before saas-backend#606
   * org-wide censuses reported a fake all-zeros id here — no need to guard for
   * that anymore.
   */
  groupID?: string
  authFields?: OrgMemberAuthField[]
  twoFaFields?: OrgMemberTwoFaField[]
}

/** Body of `POST /census/{id}/group/{groupId}/publish`. */
export interface PublishCensusGroupRequest {
  authFields?: OrgMemberAuthField[]
  twoFaFields?: OrgMemberTwoFaField[]
  weighted?: boolean
}

/** Body of `POST /census/{id}/publish`. */
export interface PublishCensusRequest {
  authFields?: OrgMemberAuthField[]
  twoFaFields?: OrgMemberTwoFaField[]
  weighted?: boolean
}

/** Response of the census publish endpoints. */
export interface PublishedCensusResponse {
  uri: string
  /** Census Merkle root (hex). */
  root: string
  size: number
}

/** Body of `POST /census/{id}` — adds existing org members to the census. */
export interface AddCensusParticipantsRequest {
  memberIds: string[]
}

/** `GET /census/{id}/participants` — the member ids in the census. */
export interface CensusParticipantsResponse {
  censusId: string
  memberIds: string[]
}

// ─── Election ─────────────────────────────────────────────────────────────────

export type ElectionStatus = 'READY' | 'PAUSED' | 'ENDED' | 'CANCELED' | 'UPCOMING'

/**
 * Per-question (on-chain election) status. Each question in a voting process is
 * a separate Vochain election, so its status follows the Vochain lifecycle.
 * Use {@link computeProcessStatus} (from `@vocdoni/api-client`) to derive a
 * combined status for the whole process.
 *
 * Wire caveat: the backend emits `READY` for a live question — the same
 * semantic state as `ONGOING`. `@vocdoni/api-client` normalizes it to
 * `ONGOING` on every process/question read (`normalizeQuestionStatus`), so
 * `READY` is deliberately not part of this union; raw wire data that skipped
 * the client may still carry it.
 */
export type QuestionStatus =
  | 'PROCESS_UNKNOWN'
  | 'UPCOMING'
  | 'ONGOING'
  | 'ENDED'
  | 'CANCELED'
  | 'PAUSED'
  | 'RESULTS'

/**
 * Language-keyed election text, e.g. `{ default: 'Hello', es: 'Hola' }`. The SaaS
 * API stores every human-facing string (titles, descriptions, choice labels) this
 * way and rejects a bare string; the `default` key is the fallback locale.
 */
export type MultiLangString = Record<string, string>

/**
 * Election text as accepted by the SDK: either a plain `string` — which the
 * client normalizes to `{ default: value }` before sending — or an explicit
 * {@link MultiLangString}. Responses always come back as a {@link MultiLangString}.
 */
export type LocalizedInput = string | MultiLangString

/**
 * Extended per-choice display info: an illustrative image and a longer
 * description, rendered by the "extended" choice presentation.
 *
 * The API has nowhere to store this on a choice (`db.Choice` is
 * `{Title, Value}`), so it lives in the parent question's free-form
 * {@link VotingProcessQuestion.metadata} bag under `choices`, keyed by choice
 * `value` — see {@link ChoiceMetadataEntry}. The client folds it back onto each
 * choice as {@link Choice.meta} on read.
 *
 * `description` and `image` are the keys the SDK's display components read;
 * the bag is open, so any other key a creator stored on the entry is carried
 * over verbatim for custom `QuestionChoice` slots to consume.
 */
export interface ChoiceMeta {
  description?: string
  image?: {
    default?: string
    thumbnail?: string
  }
  /** Creator-defined keys, passed through untouched. */
  [key: string]: unknown
}

/**
 * One entry of a question's `metadata.choices` array — the storage form of
 * {@link ChoiceMeta}, tied to a choice by its `value`.
 *
 * `image` is tolerated in both shapes on read: a plain URL string (what the
 * creation flows write) is normalized to `{ default: url }`, an explicit
 * `{ default, thumbnail }` object is passed through. Entries whose `value`
 * matches no choice of the question are ignored.
 *
 * `value` is the join key and is stripped when the entry is folded onto the
 * choice; every other key lands on {@link ChoiceMeta}.
 */
export interface ChoiceMetadataEntry {
  value: number
  description?: string
  image?: string | { default?: string; thumbnail?: string }
  /** Creator-defined keys, carried over to {@link ChoiceMeta} untouched. */
  [key: string]: unknown
}

export interface Choice {
  title: LocalizedInput
  value: number
  /**
   * Extended display info. **Response-only and client-derived**: the API stores
   * it on the parent question (`metadata.choices`, see
   * {@link ChoiceMetadataEntry}) and the client maps it here on read, so
   * setting it on a create/update request has no effect — write
   * `question.metadata.choices` instead.
   *
   * Absent when the question carries no `metadata.choices` entry for this
   * choice's `value`.
   */
  meta?: ChoiceMeta
}

export interface Question {
  title: LocalizedInput
  description?: LocalizedInput
  choices: Choice[]
}

export interface VoteType {
  maxCount: number
  maxValue: number
  maxVoteOverwrites: number
  costExponent: number
  uniqueChoices: boolean
  costFromWeight: boolean
}

export interface ElectionType {
  /** Whether the process starts automatically at its start date. */
  autostart?: boolean
  interruptible: boolean
  /** Whether the census can grow after the process starts. */
  dynamicCensus?: boolean
  secretUntilTheEnd: boolean
  anonymous: boolean
  metadata?: { encrypted: boolean }
}

export interface Election {
  id: string
  /**
   * On-chain (Vochain) process id, 64-hex. Returned as `address` by
   * `GET /process/{id}`; this is the id the vote/sign/check flow signs against.
   * The top-level `id` is the Mongo ObjectID used to fetch the process.
   *
   * Required: the CSP check/sign and the vote envelope are keyed by this id, and
   * the Mongo id is not a valid substitute. {@link mapProcessToElection} throws
   * if the process response omits it.
   */
  address: string
  /** Vochain chain id the vote signs against, e.g. "vocdoni/DEV/36". */
  chainId?: string
  title: LocalizedInput
  description?: LocalizedInput
  header?: string
  status: ElectionStatus
  startDate: string
  endDate: string
  organizationId: string
  voteCount: number
  finalResults: boolean
  results?: string[][]
  /** Process census info (auth fields, type, size) — see {@link CensusInfo}. */
  census?: CensusInfo
  questions: Question[]
  voteType: VoteType
  electionType: ElectionType
  encryptionPublicKeys?: EncryptionKey[]
  /** Open-ended metadata stored by the creator — e.g. census.salt / census.fields / census.specs for spreadsheet elections, token.decimals for web3 elections */
  meta?: Record<string, unknown>
}

export interface EncryptionKey {
  index: number
  key: string
}

// ─── Election API ─────────────────────────────────────────────────────────────

/** Synchronous response of `POST /process/{id}/publish` when already published. */
export interface PublishProcessResponse {
  /** On-chain (Vochain) process id, hex. */
  address: string
  status: string
}

export interface SetElectionStatusRequest {
  status: 'ready' | 'paused' | 'ended' | 'canceled'
}

export interface ElectionMetadata {
  title: LocalizedInput
  description?: LocalizedInput
  questions: Question[]
  media?: { header?: string }
}

export interface ElectionListParams {
  /**
   * Owner organization address filter. The returned list items echo it as
   * UNPREFIXED lowercase hex regardless of the form passed here — see
   * {@link VotingProcessBase.orgAddress}.
   */
  orgAddress: string
  status?: string
  page?: number
  limit?: number
  /**
   * Drafts filter (saas-backend#607). `true` → published processes only;
   * `false` → drafts only, **Manager/Admin required** (401 otherwise);
   * omitted → the caller's default view (anonymous sees published only, a
   * manager sees everything).
   *
   * Caveat: combining `published: false` with `status` returns nothing — a
   * draft's questions have no on-chain status yet and `status` matches on
   * that field.
   */
  published?: boolean
}

export interface BallotProtocol {
  costExponent: number
  costFromWeight: boolean
  maxCount: number
  maxTotalCost: number
  maxValue: number
  maxVoteOverwrites: number
  /**
   * Every ballot field must carry a distinct value. Applied by the scrutinizer to
   * the **raw field values**, not to "the choices a voter picked" — so it is
   * unsatisfiable whenever there are fewer legal values than fields, and in
   * particular on the dense 0/1 layout (`maxValue: 1`, `maxCount > 1`), where a
   * ballot can only ever hold two distinct values. An unsatisfiable protocol
   * produces an election that accepts votes and tallies zeros; check one with
   * `unsatisfiableProtocolReason` from `@vocdoni/ballot` (which
   * `@vocdoni/api-client` runs on every create/update).
   */
  uniqueValues: boolean
}

export interface QuestionTypeSetup {
  maxChoices: number
  minChoices: number
  /**
   * ⚠️ Must be `false` for `"multichoice"`. The backend derives the **dense**
   * layout for that type (one 0/1 field per choice) yet still maps this flag onto
   * the on-chain `voteMode.uniqueValues`, which the scrutinizer applies to raw
   * field values — a 0/1 vector over more than two choices always repeats a value,
   * so every ballot is discarded at tally and the election reports zeros while
   * still counting `voteCount`. Both the API and `@vocdoni/api-client` reject it
   * on create/update rather than correcting it — a ranked ballot is expressed as a
   * raw {@link BallotProtocol} instead. Detect an already-created broken question
   * with `unsatisfiableQuestionReason` from `@vocdoni/ballot`.
   */
  uniqueChoices: boolean
}

/**
 * A question's on-chain tally, resolved live on read. Present on the single
 * reads (`GET /processes/{id}`, the public question read) for any published
 * question — `finalResults` marks live vs final. The inner `results` matrix is
 * absent until a tally exists (empty while a `secretUntilTheEnd` election is
 * still encrypted, or before any vote), so poll on an absent/empty matrix.
 * The list endpoint never resolves it (N+1 avoidance): absence in a LIST item
 * means "not resolved here", not "no results".
 */
export interface QuestionResults {
  voteCount?: number
  /** On-chain `maxCensusSize` of the question's election. */
  maxVoters?: number
  /** `true` once the on-chain tally is final; `false` while live. */
  finalResults?: boolean
  /**
   * Raw on-chain tally matrix (stringified big integers), one row per ballot
   * field: a single-choice question has one row indexed by choice value
   * (0..maxValue, so sparse choice values leave empty buckets); a multi-choice
   * question has one row per choice, each `[notSelected, selected]`.
   */
  results?: string[][]
}

export interface VotingProcessQuestion {
  id: string
  parentProcessId: string
  upstreamId?: string
  title: MultiLangString
  description?: MultiLangString
  choices: Choice[]
  /**
   * Per-question voter restriction (member ids). Only served to org
   * managers/admins (or a scoped API key) — the now-public process read strips
   * it for everyone else, so absence does not mean "unrestricted".
   */
  eligibleMemberIds?: string[]
  ballotProtocol: BallotProtocol
  /**
   * Named question type as stored — `"singlechoice"` / `"multichoice"` when
   * the question was created with one (see {@link VotingProcessQuestionType}),
   * empty for raw-`ballotProtocol` questions. Kept as `string` defensively.
   */
  type: string
  typeSetup?: QuestionTypeSetup
  secretUntilTheEnd: boolean
  status: QuestionStatus
  /**
   * Open-ended metadata stored by the creator. Its `choices` key is
   * SDK-recognized: an array of {@link ChoiceMetadataEntry} carrying each
   * choice's extended display info, which the client folds onto the matching
   * {@link Choice.meta} on read.
   */
  metadata?: Record<string, unknown>
  /**
   * On-chain vote-encryption public keys — only for `secretUntilTheEnd`
   * questions. Absent (not an empty array) until the keykeepers publish the
   * keys; treat absence as "not yet published" and poll before building an
   * encrypted ballot.
   */
  encryptionKeys?: EncryptionKey[]
  /**
   * Live on-chain tally — resolved only on the single reads for published
   * questions; see {@link QuestionResults} for the list-endpoint caveat.
   */
  results?: QuestionResults
}

/**
 * Inline census definition of a voting process. There is no census id / type /
 * uri over this API by design — the census "type" is inferred from
 * `authFields`/`twoFaFields` (every new-model census is CSP-backed), and
 * member management goes through the process-scoped routes
 * (`GET /processes/{id}/participants`, `PUT /processes/{id}/census`).
 */
export interface CensusSpec {
  authFields?: OrgMemberAuthField[]
  /**
   * Org member group the census was built from. Round-trips since
   * saas-backend#606: echoed back on process reads so a client can restore the
   * group a draft targeted. Absent (not a zero id) when the census is
   * organization-wide.
   */
  groupId?: string
  /**
   * Explicit member selection, as an alternative to `groupId`. Write-only: a
   * process read echoes the census config, not the member list it resolved to.
   */
  memberIds?: string[]
  twoFaFields?: OrgMemberTwoFaField[]
  weighted?: boolean
  /**
   * Number of members in the census. Response-only (ignored on create/update);
   * for a published process it equals the on-chain `maxCensusSize` of its
   * whole-census questions. Serialized with `omitempty`, so `0` arrives absent.
   */
  size?: number
  /**
   * Whole-census total voting weight (sum of members' weights). Response-only;
   * equals `size` for a non-weighted census. Needed to turn per-answer weights
   * into percentages (e.g. results reports). Serialized with `omitempty`.
   */
  totalWeight?: number
}

/** Per-question member eligibility restriction (subset of the process census). */
export interface EligibilitySpec {
  groupId?: string
  memberIds?: string[]
}

/**
 * Body of `POST /processes/census/validation` — a pre-flight check of a
 * {@link CensusSpec} against an organization's members, without creating
 * anything. On 400, the error body carries the offending duplicate/missing-data
 * member ids.
 */
export interface ValidateProcessCensusRequest {
  orgAddress: string
  census: CensusSpec
}

/**
 * Response of `POST /processes/census/validation` when the census is usable.
 * The backend answers a bare JSON string (not an object); treat it as a
 * success signal only — failures come back as a 400 error instead.
 */
export type ValidateProcessCensusResponse = string

/**
 * Fields shared by both variants of {@link VotingProcessResponse}. Returned by
 * `GET /processes/{id}` and as the list items of `GET /processes` — both
 * **public** routes since saas-backend#599, draft-gated: published processes
 * are readable by anyone (with `eligibleMemberIds` stripped for non-managers);
 * drafts 404 on the single read and are filtered from the list unless the
 * caller is an org manager/admin or a scoped API key.
 */
export interface VotingProcessBase {
  /** Process id, a Mongo ObjectID (24-hex chars) — never a `0x…` hex id. */
  id: string
  /**
   * Owner organization address as UNPREFIXED lowercase hex (e.g.
   * `"1a9ffe1f4c2493578ce4a7dbebd7d95433eee6f0"`). Beware: other endpoints
   * (`GET /auth/addresses`, `GET /organizations/{address}`) return the same
   * logical value `0x`-prefixed, so never compare the raw strings across
   * endpoints — strip/normalize the `0x` prefix first.
   */
  orgAddress: string
  title: MultiLangString
  description?: MultiLangString
  header?: string
  streamUri?: string
  census: CensusSpec
  questions: VotingProcessQuestion[]
  /**
   * Vochain chain id votes must be signed against — vote signatures are
   * chain-id-bound (a mismatch makes the on-chain signer recovery diverge).
   * Serialized with `omitempty`.
   */
  chainId?: string
}

/**
 * A process that has not been published yet. Drafts can legitimately lack both
 * dates: `endDate` is optional at creation and `startDate` may be omitted to
 * mean "start immediately on publish". The backend serializes both with
 * `omitempty`, so absent means absent — do not synthesize values.
 */
export interface DraftVotingProcessResponse extends VotingProcessBase {
  published: false
  startDate?: string
  endDate?: string
}

/**
 * A published process. Publish validation hard-requires a future `endDate`, so
 * it is always present.
 *
 * Caveat: the `startDate` guarantee lands with saas-backend#586 (backfills
 * `startDate` at publish), merged 2026-07 — processes published before that
 * deploy may still omit `startDate`, so runtime consumers should stay
 * defensive about its absence when reading older processes.
 */
export interface PublishedVotingProcessResponse extends VotingProcessBase {
  published: true
  startDate: string
  endDate: string
}

/**
 * Response of `GET /processes/{id}` (and list items of `GET /processes`),
 * discriminated on `published`: drafts may lack `startDate`/`endDate`;
 * published processes always carry them. Narrow on `published` before reading
 * the dates.
 */
export type VotingProcessResponse = DraftVotingProcessResponse | PublishedVotingProcessResponse

export interface VotingProcessListResponse {
  processes: VotingProcessResponse[]
  pagination: Pagination
}

/** Public read of a single question; returned by `GET /processes/{id}/questions/{qId}`. */
export interface PublicQuestionResponse {
  id: string
  parentProcessId: string
  upstreamId?: string
  title: MultiLangString
  description?: MultiLangString
  choices: Choice[]
  ballotProtocol?: BallotProtocol
  census?: CensusSpec
  type?: string
  typeSetup?: QuestionTypeSetup
  secretUntilTheEnd: boolean
  status: QuestionStatus
  metadata?: Record<string, unknown>
  /**
   * On-chain vote-encryption public keys — only for `secretUntilTheEnd`
   * questions. The field is absent (not an empty array) until the keykeepers
   * publish the keys, so treat absence as "not yet published" and poll before
   * building an encrypted ballot.
   */
  encryptionKeys?: EncryptionKey[]
  /**
   * Live on-chain tally, present for any published question — see
   * {@link QuestionResults}.
   */
  results?: QuestionResults
}

/** Per-question entry in `GET /processes/{id}/results` — a {@link QuestionResults} plus ids. */
export interface VotingProcessQuestionResults extends QuestionResults {
  questionId: string
  upstreamId?: string
}

/** Response of `GET /processes/{id}/results`. */
export interface VotingProcessResultsResponse {
  id: string
  questions: VotingProcessQuestionResults[]
}

/** Response of `GET /processes/{id}/check` — publish-readiness dry-run. */
export interface VotingProcessValidateResponse {
  valid: boolean
  errors?: string[]
}

/**
 * Named question types the backend accepts — lowercase only. CamelCase
 * variants (`"singleChoice"`, `"multiChoice"`) are rejected with
 * `unsupported type` (error code 40037), and there is no `"approval"` type.
 */
export const VOTING_PROCESS_QUESTION_TYPES = ['singlechoice', 'multichoice'] as const

/** Named question type — see {@link VOTING_PROCESS_QUESTION_TYPES}. */
export type VotingProcessQuestionType = (typeof VOTING_PROCESS_QUESTION_TYPES)[number]

/**
 * Question input for {@link CreateVotingProcessRequest}. Each question carries
 * its own ballot protocol.
 *
 * Each question requires EITHER a named `type` OR a raw `ballotProtocol`;
 * omitting both is rejected with "a type or a ballotProtocol is required".
 * When both are given, `ballotProtocol` wins.
 */
export interface VotingProcessQuestionRequest {
  title: LocalizedInput
  description?: LocalizedInput
  choices?: Choice[]
  /** Raw ballot protocol; overrides `type` + `typeSetup` when both are given. */
  ballotProtocol?: BallotProtocol
  /** Per-question member eligibility restriction. */
  census?: EligibilitySpec
  /**
   * Named question type. Lowercase only — the backend rejects `"singleChoice"`
   * / `"multiChoice"` with `unsupported type` (40037). Required unless
   * `ballotProtocol` is given (which takes precedence over it).
   */
  type?: VotingProcessQuestionType
  /**
   * Type-specific configuration. Required for `"multichoice"`, which validates
   * `1 <= maxChoices <= choices.length` and `minChoices <= maxChoices`.
   * `"singlechoice"` ignores it. See {@link QuestionTypeSetup.uniqueChoices} for
   * why that one flag is rejected on multichoice.
   */
  typeSetup?: QuestionTypeSetup
  secretUntilTheEnd?: boolean
  metadata?: Record<string, unknown>
}

/** Body of `POST /processes` and `PUT /processes/{id}` — flat process draft with per-question ballot protocols. */
export interface CreateVotingProcessRequest {
  /**
   * Owner organization address. The request side tolerates the `0x`-prefixed
   * form (verified live), but note the asymmetry: process reads
   * ({@link VotingProcessResponse}) always return it back as UNPREFIXED
   * lowercase hex, so don't expect to read back what you sent.
   */
  orgAddress: string
  census?: CensusSpec
  title: LocalizedInput
  description?: LocalizedInput
  header?: string
  streamUri?: string
  startDate?: string
  endDate?: string
  questions: VotingProcessQuestionRequest[]
}

/** Response of `POST /processes`. */
export interface CreateVotingProcessResponse {
  /** New process id — a Mongo ObjectID (24-hex chars), never a `0x…` hex id. */
  processId: string
}

/** Identifies one target question by id inside {@link SetQuestionsStatusRequest}. */
export interface QuestionStatusID {
  id: string
}

/** Body of `PUT /processes/{id}/questions/status` — bulk question status change. */
export interface SetQuestionsStatusRequest {
  status: string
  /** Questions to transition; omitted/empty targets every published question. */
  questions?: QuestionStatusID[]
}

// ─── Vote relay ───────────────────────────────────────────────────────────────

export interface RelayVoteRequest {
  /** Hex of a marshaled SignedTx whose inner Tx is a Vote envelope. */
  txPayload: string
}

export interface RelayVoteResponse {
  /** Async job id — poll GET /jobs/{jobId} for the resulting vote nullifier. */
  jobId: string
}

/**
 * Body of `POST /votes` (saas-backend#610) — batch relay of already-signed
 * votes, at most 100 per call. The whole batch is validated synchronously and
 * accepted or rejected as a unit (every payload must decode to a Vote for a
 * known process, all must belong to one organization, and the queue must have
 * room for all): a rejected batch relays NOTHING, closing the half-voted
 * window of per-envelope relaying. Returns 202 with a single job covering the
 * batch — its {@link JobResult.votes} reports every envelope in request order.
 */
export interface RelayVotesRequest {
  /** Signed vote transactions, at most 100. */
  votes: RelayVoteRequest[]
}

// ─── Jobs (async transaction outcomes) ─────────────────────────────────────────

export type JobStatus = 'pending' | 'completed' | 'failed'

export type JobType =
  | 'org_members'
  | 'census_participants'
  | 'publish_process'
  | 'set_process_status'
  | 'set_process_census'
  | 'relay_vote'
  | 'relay_votes'
  | 'publish_voting_process'

/**
 * One envelope's outcome in a `relay_votes` batch job, index-aligned with the
 * {@link RelayVotesRequest.votes} that created it. `processId` and `nullifier`
 * are derived from the signed envelope and seeded at job creation, so they are
 * readable while the entry is still `pending`; `voteID` (the chain-assigned
 * id) or `error` arrive when the entry settles.
 */
export interface VoteJobResult {
  processId: string
  nullifier: string
  status: JobStatus
  voteID?: string
  error?: string
}

/** Unified job result — each field is only populated by the job types that produce it. */
export interface JobResult {
  address?: string
  status?: string
  /** Vote nullifier — present once a relay_vote job completes. */
  voteID?: string
  /**
   * Vote nullifier, derived from the signed envelope and seeded at job
   * creation (relay_vote) — readable while the job is still pending, unlike
   * `voteID` which the chain assigns on success.
   */
  nullifier?: string
  /** Voting process id the relayed vote targets — seeded at creation (relay_vote). */
  processId?: string
  /**
   * Per-envelope outcomes of a `relay_votes` batch, in request order. The job
   * completes when every entry succeeded and fails otherwise — read this array
   * (also present on a failed job) for the per-vote truth.
   */
  votes?: VoteJobResult[]
  /** Members/census rows imported so far — produced by member/census import jobs. */
  added?: number
  /** Total rows to import — produced by member/census import jobs. */
  total?: number
  /** added / total * 100 — produced by member/census import jobs. */
  progress?: number
}

export interface JobStatusResponse {
  jobId: string
  status: JobStatus
  type: JobType
  result?: JobResult
  errors?: string[]
}

export interface EnqueuedResponse {
  jobId: string
}

// ─── CSP voter auth ─────────────────────────────────────────────────────────────
// The CSP / two-factor voter-auth flow lives on the process-scoped
// /processes/{processId}/* routes: a single verified authToken is reused across
// every election (question) of the process.
// Note: `weight` is wire-encoded as a hex string (e.g. "2a" === 42).

/** Auth step 0/1 bodies are free-form (they vary by census auth type). */
/**
 * Auth step 0 — identify the participant. Pass every field the census requires
 * in this one object; the census `authFields` lists which ones (one or several,
 * e.g. just `memberNumber`, or `name` + `surname` + `birthDate`). Extra fields
 * are ignored. For auth-only censuses (no 2FA) step 0 already returns a verified
 * token.
 */
export interface AuthRequest {
  name?: string
  surname?: string
  memberNumber?: string
  nationalId?: string
  birthDate?: string
  email?: string
  phone?: string
}

/** Auth step 1 — confirm the 2FA challenge. Not used by auth-only censuses. */
export interface AuthChallengeRequest {
  authToken: string
  /** Challenge solution(s); the OTP is `authData[0]`. */
  authData: string[]
}


/** Shared response shape of the auth, resend and sign endpoints. */
export interface AuthResponse {
  authToken?: string
  /** Hex CSP signature — present on the sign response. */
  signature?: string
  /** Hex-encoded census weight. */
  weight?: string
}

export interface AuthResendRequest {
  authToken: string
  email?: string
  phone?: string
}

/** Body of `POST /processes/{id}/check` (`handlers.CheckMembershipRequest`). */
export interface CheckMembershipRequest {
  authToken: string
  /** Optional Vochain election id filter; the check reports all questions without it. */
  electionId?: string
}

/** One question's eligibility/vote status in {@link ProcessCheckResponse}. */
export interface ProcessQuestionStatus {
  questionId: string
  /** Vochain election id of the question (64-hex). */
  upstreamId?: string
  /** Whether the voter is eligible for this question (eligibility subset). */
  canVote: boolean
  /** Whether the voter has already consumed this question's election. */
  hasVoted: boolean
}

/**
 * Response of `POST /processes/{id}/check` — the voter's status for a voting
 * process: census membership, weight, and per-question eligibility/vote status.
 * Ineligibility is reported as `belongsToProcess: false` with HTTP 200, not an
 * error.
 */
export interface ProcessCheckResponse {
  belongsToProcess: boolean
  questions: ProcessQuestionStatus[]
  /** Hex-encoded census weight. */
  weight?: string
}

export interface SignRequest {
  authToken: string
  electionId: string
  /** Hex address to be signed by the CSP. */
  payload: string
  /** Blinding R point — only used by blind-salted censuses. */
  tokenR?: string
}

// ─── Batch signing ────────────────────────────────────────────────────────────

/**
 * Why a ballot could not be signed, in {@link SignBatchResult}. Stable and
 * machine-readable; the accompanying `error` is a human string that may change.
 *
 * Retryable: `already_signing` (a concurrent request holds the lock) and
 * `sign_failed` (transient signer/storage failure). Terminal:
 * `already_consumed`, `auth_invalid` (re-authenticate), `address_mismatch`.
 * `blind_request_missing` and `invalid_blinded_message` belong to the blind
 * (anonymous census) signing flow, which shares this outcome set.
 */
export type SignFailureCode =
  | 'already_consumed'
  | 'already_signing'
  | 'auth_invalid'
  | 'address_mismatch'
  | 'sign_failed'
  | 'blind_request_missing'
  | 'invalid_blinded_message'

/** One ballot of a {@link SignBatchRequest}. */
export interface SignBatchBallot {
  /** Vochain election id of the question (64-hex). */
  upstreamId: string
  /** Hex address to be signed by the CSP for this question. */
  address: string
}

/**
 * Body of `POST /processes/{id}/sign-batch` (saas-backend#634) — the batch
 * form of {@link SignRequest}: one auth token, one ballot per question, signed
 * in a single call. Authorization is all-or-nothing; per-question failures
 * come back inline in the response.
 */
export interface SignBatchRequest {
  authToken: string
  ballots: SignBatchBallot[]
}

/**
 * One ballot's outcome in a batch sign. Exactly one of `signature` and `code`
 * is set.
 */
export interface SignBatchResult {
  /** Vochain election id of the question (64-hex). */
  upstreamId: string
  /** Hex CSP signature, on success. */
  signature?: string
  /** Hex-encoded census weight the ballot was signed with, on success. */
  weight?: string
  code?: SignFailureCode
  error?: string
}

/** Response of `POST /processes/{id}/sign-batch` — one result per ballot, in request order. */
export interface SignBatchResponse {
  signatures: SignBatchResult[]
}

export interface UserWeightRequest {
  authToken: string
}

export interface UserWeightResponse {
  /** Hex-encoded census weight. */
  weight?: string
}

// ─── Consumed address (sign-info) ──────────────────────────────────────────────

export interface ConsumedAddressRequest {
  authToken: string
}

/** Legacy response of `POST /process/{id}/sign-info` (single-election model). */
export interface ConsumedAddressResponse {
  authToken?: string
  /** Vote nullifier of the consumed process. */
  nullifier: string
  /** Consumption timestamp. */
  at: string
}

/** One question's consumed voting info in {@link ProcessSignInfoResponse}. */
export interface QuestionConsumedAddress {
  questionId: string
  /** Vochain election id of the question (64-hex). */
  upstreamId: string
  /** Ephemeral address that consumed the question's election. */
  address: string
  /** Vote nullifier. */
  nullifier: string
  /** Consumption timestamp. */
  at: string
}

/**
 * Response of `POST /processes/{id}/sign-info` — the voter's consumed
 * addresses/nullifiers across a voting process, one entry per question the
 * voter has already cast (questions not voted are omitted).
 */
export interface ProcessSignInfoResponse {
  consumed: QuestionConsumedAddress[]
}

/**
 * Member field the admin participants lookup can match on
 * (`GET /processes/{id}/participants?field=&value=`). Note this is narrower
 * than {@link OrgMemberAuthField}: name/surname/birthDate are not queryable.
 */
export type ProcessParticipantLookupField = 'email' | 'phone' | 'memberNumber' | 'nationalId'

/**
 * One question's voted status for a matched participant — `hasVoted` is true
 * when the member has consumed that question's on-chain election. Questions
 * not yet published (no `upstreamId`) are omitted from the list.
 */
export interface ProcessParticipantQuestionVote {
  questionId: string
  /** Vochain election id of the question (64-hex). */
  upstreamId?: string
  hasVoted: boolean
}

/** A matched org member that is also a participant of the process census. */
export interface ProcessParticipantEntry {
  memberId: string
  name?: string
  surname?: string
  email?: string
  memberNumber?: string
  questions: ProcessParticipantQuestionVote[]
}

/**
 * Response of `GET /processes/{id}/participants?field=&value=` — org members
 * matching the lookup that are participants of the process census, with their
 * per-question voted status. Manager/Admin only. Empty when none match.
 */
export interface ProcessParticipantsResponse {
  participants: ProcessParticipantEntry[]
}

/**
 * Response of `PUT /processes/{id}/census` — the number of members added to
 * the census synchronously, plus the async job id that raises each published
 * election's `maxCensusSize` on-chain (absent when no on-chain update was
 * needed). Only published processes can have their census extended; drafts are
 * edited through `PUT /processes/{id}` instead (409 otherwise).
 */
export interface UpdateProcessCensusResponse {
  jobId?: string
  added: number
  errors?: string[]
}

// ─── Pagination ─────────────────────────────────────────────────────────────────

export interface Pagination {
  totalItems: number
  previousPage: number | null
  currentPage: number
  nextPage: number | null
  lastPage: number
}

// ─── Organizations (full SaaS shape) ───────────────────────────────────────────
// The integrator / managed-org flows use the same `apicommon.OrganizationInfo`
// schema as {@link Organization}. Kept as an alias so existing call sites keep
// working without duplicating the field list.

export type OrganizationInfo = Organization

/**
 * Body of `POST /integrator/organizations` — creates a managed organization.
 * Same shape as {@link CreateOrganizationRequest} plus `ownerEmail`; setting
 * `integrator: true` on the underlying org-create fields opts the new managed
 * org into the free integrator plan.
 */
export type CreateManagedOrganizationRequest = CreateOrganizationRequest & {
  /**
   * Optionally assign an existing user (by email) as the managed org's admin,
   * defaults to the calling user.
   */
  ownerEmail?: string
}

export interface ManagedOrganizationsResponse {
  organizations: OrganizationInfo[]
  pagination?: Pagination
}

// ─── Organization members (memberbase) ──────────────────────────────────────────

export interface OrgMember {
  /** Internal member id (member UID); assigned by the backend. */
  id?: string
  email?: string
  phone?: string
  memberNumber?: string
  nationalId?: string
  name?: string
  surname?: string
  birthDate?: string
  weight?: number
  other?: Record<string, unknown>
}

export interface AddMembersRequest {
  members: OrgMember[]
}

/** Response of `POST /organizations/{address}/members`. Async for large batches. */
export interface AddMembersResponse {
  added: number
  errors?: string[]
  /** Present when the add runs asynchronously — poll via `GET /jobs/{jobId}` (`jobs.waitFor`). */
  jobId?: string
}

export interface OrganizationMembersResponse {
  members: OrgMember[]
  pagination?: Pagination
}

export interface DeleteMembersRequest {
  ids?: string[]
  all?: boolean
}

export interface DeleteMembersResponse {
  count: number
}

// ─── Organization member groups ─────────────────────────────────────────────────
// Uploading members auto-creates the "All members" auto group, listed first.

export interface OrganizationGroup {
  id: string
  title?: string
  description?: string
  memberIds?: string[]
  censusIds?: string[]
  membersCount?: number
  /** The auto-generated "All members" group (cannot be deleted/edited). */
  isAutoGroup?: boolean
  createdAt?: string
  updatedAt?: string
}

export interface OrganizationGroupsResponse {
  groups: OrganizationGroup[]
  pagination?: Pagination
}

export interface CreateGroupRequest {
  title: string
  description?: string
  /** Optional when `includeAllMembers` is true. */
  memberIds?: string[]
  includeAllMembers?: boolean
}

export interface CreateGroupResponse {
  id: string
}

export interface UpdateGroupRequest {
  title?: string
  description?: string
  addMembers?: string[]
  removeMembers?: string[]
}

export interface ListGroupMembersResponse {
  members: OrgMember[]
  pagination?: Pagination
}

export interface ValidateGroupRequest {
  authFields?: OrgMemberAuthField[]
  twoFaFields?: OrgMemberTwoFaField[]
}

// ─── API keys (integrator) ──────────────────────────────────────────────────────

export interface CreateApiKeyRequest {
  label: string
  /** Subset of: quota:read, managed:read, managed:write, voting:write, members:write. */
  scopes: string[]
  expiresAt?: string
}

export interface ApiKeyInfo {
  id: string
  label: string
  prefix: string
  scopes: string[]
  createdBy: string
  createdAt: string
  lastUsedAt?: string
  expiresAt?: string
  revoked: boolean
}

/** Returned once at creation — `secret` is never retrievable again. */
export interface CreateApiKeyResponse extends ApiKeyInfo {
  secret: string
}

export interface ListApiKeysResponse {
  apiKeys: ApiKeyInfo[]
}

// ─── Organization meta ──────────────────────────────────────────────────────────

export interface OrganizationMetaRequest {
  meta: Record<string, unknown>
}

export interface OrganizationMetaResponse {
  meta: Record<string, unknown>
}

// ─── Misc reads ─────────────────────────────────────────────────────────────────

export interface OrganizationAddresses {
  addresses: string[]
}

export interface JobsResponse {
  jobs: JobStatusResponse[]
  pagination?: Pagination
}

export interface OrganizationRole {
  role: string
  name: string
  organizationWritePermission: boolean
  processWritePermission: boolean
}

export interface OrganizationType {
  type: string
  name: string
}

export interface OrganizationCensusesResponse {
  censuses: OrganizationCensus[]
}

export interface SubscriptionDetails {
  planId: string
  startDate: string
  renewalDate: string
  lastPaymentDate: string
  active: boolean
  email: string
}

export interface SubscriptionUsage {
  /** Number of voting processes created. */
  processes: number
  /** Number of emails sent. */
  sentEmails: number
  /** Number of SMS messages sent. */
  sentSMS: number
  /** Number of votes relayed. */
  sentVotes: number
  /** Number of sub-organizations created. */
  subOrgs: number
  /** Number of users in the organization. */
  users: number
}

/** A subscription plan (`GET /plans`). Nested limit objects are left open-ended. */
export interface SubscriptionPlan {
  id: string
  name: string
  monthlyPrice: number
  yearlyPrice: number
  default: boolean
  organization?: unknown
  votingTypes?: unknown
  features?: unknown
  integratorLimits?: unknown
}

export interface OrganizationSubscriptionInfo {
  subscriptionDetails: SubscriptionDetails
  usage: SubscriptionUsage
  plan: SubscriptionPlan
}

/** `GET /organizations/{address}/processes/drafts`. `processes` are raw process docs. */
export interface OrganizationProcessDraftsResponse {
  processes: unknown[]
  pagination?: Pagination
}

export interface DeleteManagedOrganizationResponse {
  address: string
}

// ─── Service info ─────────────────────────────────────────────────────────────

/**
 * Response of the public `GET /info` — service version, Go build version, and
 * the Vocdoni chain id.
 *
 * `chainId` here is the service's CURRENT Vochain chain id — NOT necessarily
 * the chain id a given process's votes must sign against: a process published
 * before a chain migration signs against its own, older chain id. Always read
 * `chainId` off the (public) process read itself.
 */
export interface InfoResponse {
  chainId: string
  version: string
  goVersion: string
}

// ─── Client config ────────────────────────────────────────────────────────────

export interface ApiClientConfig {
  apiUrl: string
  authToken?: string | (() => string | null | undefined) | (() => Promise<string | null | undefined>)
}
