import type {
  ConsumedAddressRequest,
  CreateVotingProcessRequest,
  CreateVotingProcessResponse,
  ElectionListParams,
  ElectionMetadata,
  EnqueuedResponse,
  LocalizedInput,
  MultiLangString,
  ProcessParticipantLookupField,
  ProcessParticipantsResponse,
  ProcessSignInfoResponse,
  PublicQuestionResponse,
  PublishProcessResponse,
  RelayVoteRequest,
  RelayVoteResponse,
  RelayVotesRequest,
  SetElectionStatusRequest,
  SetQuestionsStatusRequest,
  UpdateProcessCensusResponse,
  ValidateProcessCensusRequest,
  ValidateProcessCensusResponse,
  VotingProcessListResponse,
  VotingProcessQuestionRequest,
  VotingProcessResponse,
  VotingProcessResultsResponse,
  VotingProcessValidateResponse,
} from '@vocdoni/api-types'
import { uncastableChoicesReason, unsatisfiableQuestionReason } from '@vocdoni/ballot'
import type { UpFetch } from 'up-fetch'
import { normalizeQuestionChoiceMeta } from './choice-meta'
import { normalizeQuestionStatus, normalizeVotingProcess } from './election-status'
import { handleError } from './errors'
import { JobsClient, type WaitForJobOptions } from './jobs'

/** True when a publish response is the async enqueued form (vs. already published). */
function isEnqueued(res: PublishProcessResponse | EnqueuedResponse): res is EnqueuedResponse {
  return (res as EnqueuedResponse).jobId !== undefined
}

/**
 * Coerce election text to the API's language-map form: a plain string becomes
 * `{ default: value }`, an existing {@link MultiLangString} is passed through.
 * The SaaS API rejects a bare string, so this lets callers pass either form.
 */
function toMultiLang(value: LocalizedInput | undefined): MultiLangString | undefined {
  if (value == null) return undefined
  return typeof value === 'string' ? { default: value } : value
}

/**
 * Reject a question whose ballot config could never be tallied, before it is sent.
 *
 * Both checks mirror what the backend now enforces, so this fails fast and locally
 * instead of round-tripping — and, critically, it does NOT paper over the API's
 * answer. An earlier revision of this client silently rewrote
 * `typeSetup.uniqueChoices` to `false`; that would now swallow a deliberate 400 and
 * leave the caller believing a config the backend rejected had been accepted.
 *
 * - **Named `multichoice` + `uniqueChoices`**: rejected. The type derives the dense
 *   layout (one 0/1 field per choice), where uniqueness is both vacuous — a voter
 *   cannot select the same choice twice — and fatal above two choices, since every
 *   ballot then repeats a value and is discarded at tally, leaving an all-zero
 *   result. The backend rejects it at the API boundary with the same reasoning
 *   (`api/processes.go`, and see saas-backend#619); a ranked ballot is expressed as
 *   a raw `ballotProtocol` instead.
 * - **Raw `ballotProtocol`**: rejected when unsatisfiable, matching the backend's
 *   `ValidateBallotProtocol` exactly — unsatisfiability only, never plausibility, so
 *   every shape a voter could actually satisfy stays expressible. The one addition to
 *   that mirror: a question *declared ranked* with `maxValue: 0`, which tallies every
 *   option to zero (see {@link unsatisfiableQuestionReason}). Also rejected when
 *   it publishes a choice no voter can cast (see {@link uncastableChoicesReason}) —
 *   a narrower failure the backend does not check at all: `VoteTypeFromQuestion`
 *   passes a raw protocol straight through without ever comparing it to the
 *   question's own choice values. Only reachable via a raw protocol; the named types
 *   derive bounds *from* the values (`singlechoice`) or ignore them entirely
 *   (`multichoice`, whose dense layout is position-addressed).
 */
function validateQuestionBallotConfig(question: VotingProcessQuestionRequest, index: number): void {
  if (question.ballotProtocol) {
    // The *question*-level rule: same pigeonhole check, plus the declared-ranked
    // maxValue: 0 case the protocol-level rule deliberately waves through.
    const unsatisfiable = unsatisfiableQuestionReason({
      ballotProtocol: question.ballotProtocol,
      type: question.type,
      metadata: question.metadata,
      typeSetup: question.typeSetup,
      choices: question.choices ?? [],
    })
    if (unsatisfiable) {
      throw new Error(`Question ${index}: unsatisfiable ballotProtocol — ${unsatisfiable}`)
    }
    // An option nobody can vote for is worse than an all-zero tally: the election
    // runs, most votes count, and that option quietly polls zero while voteCount
    // keeps rising. Confirmed live in integration/value-skew.itest.ts. After publish
    // there is no fix but a new election, so refuse here.
    // `metadata` is load-bearing, not decoration: `inferQuestionBallotType` reads
    // `metadata.type.name` as its second type source, ahead of every shape rule, and
    // `declaresLegacyPickSlot` reads it to tell the pick-slot layout from the dense one
    // (both present as {maxValue: 1, maxCount > 1, uniqueValues: false}). Omitting it
    // here would judge the question by shape while `encodeQuestionBallot` — which does
    // read it — judges it by name, so creation would accept a question the codec then
    // refuses: the created-but-unvotable election this guard exists to prevent. It
    // matters most on exactly this branch, since `type` is stored empty for raw
    // `ballotProtocol` questions, leaving the metadata bag as the only name.
    const uncastable = uncastableChoicesReason({
      ballotProtocol: question.ballotProtocol,
      type: question.type,
      metadata: question.metadata,
      choices: question.choices ?? [],
    })
    if (uncastable) {
      throw new Error(`Question ${index}: unreachable choice — ${uncastable}`)
    }
    return
  }

  if (question.type === 'multichoice' && question.typeSetup?.uniqueChoices) {
    throw new Error(
      `Question ${index}: uniqueChoices is not supported for multichoice, where each choice is ` +
        'an independent yes/no field — a voter already cannot select one twice, and a ' +
        'unique-values ballot over those fields admits no vote at all, tallying every election ' +
        'to zero. Set it false, or use a ballotProtocol for a ranked ballot'
    )
  }
}

/**
 * Normalize a voting process draft for the API: every human-facing string becomes a
 * language map. Question ballot configs are validated, never rewritten — see
 * {@link validateQuestionBallotConfig} for why silently correcting them is wrong.
 */
function normalizeVotingProcessRequest(req: CreateVotingProcessRequest): CreateVotingProcessRequest {
  req.questions?.forEach(validateQuestionBallotConfig)
  return {
    ...req,
    title: toMultiLang(req.title)!,
    description: toMultiLang(req.description),
    questions: req.questions?.map((q) => ({
      ...q,
      title: toMultiLang(q.title)!,
      description: toMultiLang(q.description),
      choices: q.choices?.map((c) => ({ ...c, title: toMultiLang(c.title)! })),
    })),
  }
}

/**
 * Client for SaaS processes (elections). Creation and lifecycle changes are
 * SaaS-mediated: `create` stores a draft, while `publish` and `setStatus` submit
 * on-chain transactions asynchronously and return a job id to poll (the
 * `*AndWait` helpers do the polling for you).
 */
export class ElectionsClient {
  private readonly jobs: JobsClient

  constructor(private readonly fetch: UpFetch) {
    this.jobs = new JobsClient(fetch)
  }

  /**
   * Fetch a voting process by its Mongo ObjectID from `GET /processes/{id}`.
   * Returns the flat multi-question shape ({@link VotingProcessResponse}) with
   * per-question ballot protocols and live per-question `results`. The vochain
   * id per question lives on `questions[i].upstreamId`.
   *
   * **Public** since saas-backend#599, draft-gated: published processes need
   * no auth (voter apps read `chainId` and the questions from here directly);
   * an unauthenticated read of a draft 404s — only org managers/admins or a
   * scoped API key see drafts (and the `eligibleMemberIds` restriction lists).
   */
  async get(id: string): Promise<VotingProcessResponse> {
    return this.fetch<VotingProcessResponse>(`/processes/${id}`)
      .then(normalizeVotingProcess)
      .catch(handleError)
  }

  /** Public tallies via `GET /processes/{id}/results` — live per-question {@link QuestionResults} plus ids. */
  async getResults(id: string): Promise<VotingProcessResultsResponse> {
    return this.fetch<VotingProcessResultsResponse>(`/processes/${id}/results`).catch(handleError)
  }

  /**
   * Legacy-only: `GET /process/{id}/metadata` (single-election model, vochain
   * process id). The `/processes/{id}` model has no metadata endpoint — new-model
   * consumers should read `title`/`description`/`header` from {@link get} instead.
   */
  async getMetadata(id: string): Promise<ElectionMetadata> {
    return this.fetch<ElectionMetadata>(`/process/${id}/metadata`).catch(handleError)
  }

  /**
   * List an organization's processes via `GET /processes` (public since
   * saas-backend#599). Unauthenticated callers only see published processes —
   * drafts require an org manager/admin session or scoped API key. List items
   * never carry per-question `results` (N+1 avoidance); use {@link get} or
   * {@link getResults} for tallies.
   */
  async list({ orgAddress, ...params }: ElectionListParams): Promise<VotingProcessListResponse> {
    return this.fetch<VotingProcessListResponse>('/processes', { params: { orgAddress, ...params } })
      .then((res) => ({ ...res, processes: res.processes.map(normalizeVotingProcess) }))
      .catch(handleError)
  }

  /**
   * Create a process draft via `POST /processes`. Returns the draft id (Mongo
   * ObjectID hex). Each question carries its own `ballotProtocol`; title,
   * description, and choice titles may be plain strings (normalized to
   * `{ default }`) or explicit {@link MultiLangString} maps.
   */
  async create(draft: CreateVotingProcessRequest): Promise<string> {
    const body = normalizeVotingProcessRequest(draft)
    return this.fetch<CreateVotingProcessResponse>('/processes', {
      method: 'POST',
      body,
    })
      .then((res) => res.processId)
      .catch(handleError)
  }

  /**
   * Update a draft process via `PUT /processes/{id}`. Takes the same flat
   * {@link CreateVotingProcessRequest} shape as `create`. The backend answers a
   * bare `200 OK` with no JSON body, so this resolves to void — re-{@link get}
   * the process if you need the updated shape. Fails with 409 once published.
   */
  async update(draftId: string, data: CreateVotingProcessRequest): Promise<void> {
    const body = normalizeVotingProcessRequest(data)
    await this.fetch(`/processes/${draftId}`, { method: 'PUT', body }).catch(handleError)
  }

  /** Delete a process via `DELETE /processes/{id}`. */
  async delete(id: string): Promise<void> {
    await this.fetch(`/processes/${id}`, { method: 'DELETE' }).catch(handleError)
  }

  /**
   * Publish-readiness dry-run via `GET /processes/{id}/validation`. Returns
   * `{ valid, errors }` without touching the process. (Not to be confused with
   * `POST /processes/{id}/check`, the public CSP voter-eligibility route.)
   */
  async validate(id: string): Promise<VotingProcessValidateResponse> {
    return this.fetch<VotingProcessValidateResponse>(`/processes/${id}/validation`).catch(handleError)
  }

  /**
   * Admin lookup of org members inside the process census via
   * `GET /processes/{id}/participants?field=&value=`, with each match's
   * per-question voted status. Manager/Admin only. `field` is limited to
   * {@link ProcessParticipantLookupField} — name/surname/birthDate census auth
   * fields are not queryable.
   */
  async participants(
    id: string,
    params: { field: ProcessParticipantLookupField; value: string },
  ): Promise<ProcessParticipantsResponse> {
    return this.fetch<ProcessParticipantsResponse>(`/processes/${id}/participants`, { params }).catch(handleError)
  }

  /**
   * Append existing org members to a published process's census via
   * `PUT /processes/{id}/census` (members already present are skipped). When
   * the census grows past the on-chain `maxCensusSize`, the returned `jobId`
   * tracks the async on-chain bump — wait for it with `jobs.waitFor`. Fails
   * with 409 for drafts (edit those through {@link update} instead).
   */
  async addCensusMembers(id: string, memberIds: string[]): Promise<UpdateProcessCensusResponse> {
    return this.fetch<UpdateProcessCensusResponse>(`/processes/${id}/census`, {
      method: 'PUT',
      body: { memberIds },
    }).catch(handleError)
  }

  /**
   * Pre-flight census validation via `POST /processes/census/validation`:
   * checks that the chosen auth/2FA fields produce unique, complete
   * credentials over the target members (a group, an explicit `memberIds`
   * subset, or the whole organization when neither is set), without creating
   * anything. Requires Manager/Admin role of the organization. Fails with 400
   * and the offending duplicate/missing-data member ids when the census is
   * not usable.
   */
  async validateCensus(req: ValidateProcessCensusRequest): Promise<ValidateProcessCensusResponse> {
    return this.fetch<ValidateProcessCensusResponse>('/processes/census/validation', {
      method: 'POST',
      body: req,
    }).catch(handleError)
  }

  /**
   * Publish a draft on-chain. Returns the enqueued job (`{ jobId }`) to poll, or
   * the already-published `{ address, status }` if it was published before.
   * Prefer {@link publishAndWait} unless you want to manage polling yourself.
   */
  async publish(draftId: string): Promise<PublishProcessResponse | EnqueuedResponse> {
    return this.fetch<PublishProcessResponse | EnqueuedResponse>(`/processes/${draftId}/publish`, {
      method: 'POST',
    }).catch(handleError)
  }

  /** Publish a draft and wait for the on-chain result (`{ address, status }`). */
  async publishAndWait(
    draftId: string,
    opts?: WaitForJobOptions,
  ): Promise<PublishProcessResponse> {
    const res = await this.publish(draftId)
    if (!isEnqueued(res)) return res
    const job = await this.jobs.waitFor(res.jobId, opts)
    return { address: job.result?.address ?? '', status: job.result?.status ?? '' }
  }

  /**
   * Legacy-only: change a whole election's status via `PUT /process/{id}/status`
   * (single-election model, vochain process id). The `/processes/{id}` model has
   * no process-level status route — use {@link setQuestionStatus} /
   * {@link bulkSetQuestionStatus} instead. Returns the enqueued job to poll.
   */
  async setStatus(id: string, status: SetElectionStatusRequest): Promise<EnqueuedResponse> {
    return this.fetch<EnqueuedResponse>(`/process/${id}/status`, {
      method: 'PUT',
      body: status,
    }).catch(handleError)
  }

  /** Legacy-only companion of {@link setStatus} that waits for the on-chain result. */
  async setStatusAndWait(
    id: string,
    status: SetElectionStatusRequest,
    opts?: WaitForJobOptions,
  ): Promise<PublishProcessResponse> {
    const { jobId } = await this.setStatus(id, status)
    const job = await this.jobs.waitFor(jobId, opts)
    return { address: job.result?.address ?? '', status: job.result?.status ?? '' }
  }

  /**
   * Change the status of a single question in a process.
   * `PUT /processes/{processId}/questions/{questionId}/status`.
   */
  async setQuestionStatus(processId: string, questionId: string, status: string): Promise<EnqueuedResponse> {
    return this.fetch<EnqueuedResponse>(`/processes/${processId}/questions/${questionId}/status`, {
      method: 'PUT',
      body: { status },
    }).catch(handleError)
  }

  /**
   * Bulk-change the status of multiple questions in a process.
   * `PUT /processes/{processId}/questions/status`.
   */
  async bulkSetQuestionStatus(processId: string, req: SetQuestionsStatusRequest): Promise<EnqueuedResponse> {
    return this.fetch<EnqueuedResponse>(`/processes/${processId}/questions/status`, {
      method: 'PUT',
      body: req,
    }).catch(handleError)
  }

  /**
   * Public read of a single question including its synced status and eligibility.
   * `GET /processes/{processId}/questions/{questionId}`.
   */
  async getQuestion(processId: string, questionId: string): Promise<PublicQuestionResponse> {
    return this.fetch<PublicQuestionResponse>(`/processes/${processId}/questions/${questionId}`)
      .then((q) => normalizeQuestionChoiceMeta({ ...q, status: normalizeQuestionStatus(q.status) }))
      .catch(handleError)
  }

  /**
   * Consumed-address / sign-info via `POST /processes/{id}/sign-info`: the
   * voter's consumed addresses and nullifiers, one entry per question already
   * cast. Requires the voter's verified CSP `authToken`.
   */
  async signInfo(id: string, body: ConsumedAddressRequest): Promise<ProcessSignInfoResponse> {
    return this.fetch<ProcessSignInfoResponse>(`/processes/${id}/sign-info`, {
      method: 'POST',
      body,
    }).catch(handleError)
  }

  /**
   * Relay an already-signed vote. The target process is taken from the signed
   * envelope, so the relay endpoint is the flat, public `POST /vote`.
   */
  async vote(payload: RelayVoteRequest): Promise<RelayVoteResponse> {
    return this.fetch<RelayVoteResponse>('/vote', {
      method: 'POST',
      body: payload,
    }).catch(handleError)
  }

  /**
   * Relay a batch of already-signed votes in one call (`POST /votes`,
   * saas-backend#610) — at most 100. The batch is validated synchronously and
   * accepted or rejected AS A UNIT, so a rejection relays nothing: this closes
   * the half-voted window that per-envelope relaying leaves in a
   * multi-question process. Returns a single job for the whole batch; its
   * `result.votes` reports every envelope in request order (`processId` and
   * `nullifier` readable while pending, `voteID`/`error` once settled). The
   * job completes only when every envelope succeeded and fails otherwise —
   * a failed job still carries the per-vote outcomes.
   */
  async voteBatch(payload: RelayVotesRequest): Promise<RelayVoteResponse> {
    return this.fetch<RelayVoteResponse>('/votes', {
      method: 'POST',
      body: payload,
    }).catch(handleError)
  }
}
