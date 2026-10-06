import type {
  AddMembersResponse,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  CreateGroupRequest,
  CreateManagedOrganizationRequest,
  CreateOrganizationRequest,
  DeleteManagedOrganizationResponse,
  DeleteMembersRequest,
  DeleteMembersResponse,
  IntegratorInfo,
  ListApiKeysResponse,
  ManagedOrganizationsResponse,
  Organization,
  OrganizationCensusesResponse,
  OrganizationGroup,
  OrganizationGroupsResponse,
  OrganizationInfo,
  OrganizationMembersResponse,
  OrganizationMetaRequest,
  OrganizationMetaResponse,
  OrganizationRole,
  OrganizationSubscriptionInfo,
  OrganizationType,
  OrgMember,
  SubscriptionPlan,
  UpdateGroupRequest,
  UpsertOrgMemberResponse,
} from '@vocdoni/api-types'
import type { UpFetch } from 'up-fetch'
import { handleError } from './errors'

export class OrganizationsClient {
  constructor(private readonly fetch: UpFetch) {}

  // ─── Organizations ────────────────────────────────────────────────────────

  async get(address: string): Promise<Organization> {
    return this.fetch<Organization>(`/organizations/${address}`).catch(handleError)
  }

  async create(data: CreateOrganizationRequest): Promise<Organization> {
    return this.fetch<Organization>('/organizations', {
      method: 'POST',
      body: data,
    }).catch(handleError)
  }

  async update(address: string, data: Partial<CreateOrganizationRequest>): Promise<Organization> {
    return this.fetch<Organization>(`/organizations/${address}`, {
      method: 'PUT',
      body: data,
    }).catch(handleError)
  }

  // ─── Integrator / managed organizations ───────────────────────────────────

  async getIntegratorInfo(): Promise<IntegratorInfo> {
    return this.fetch<IntegratorInfo>('/integrator').catch(handleError)
  }

  async listManaged(page?: number): Promise<ManagedOrganizationsResponse> {
    return this.fetch<ManagedOrganizationsResponse>('/integrator/organizations', {
      params: page !== undefined ? { page } : undefined,
    }).catch(handleError)
  }

  async createManaged(data: CreateManagedOrganizationRequest): Promise<OrganizationInfo> {
    return this.fetch<OrganizationInfo>('/integrator/organizations', {
      method: 'POST',
      body: data,
    }).catch(handleError)
  }

  async deleteManaged(orgAddress: string): Promise<DeleteManagedOrganizationResponse> {
    return this.fetch<DeleteManagedOrganizationResponse>(
      `/integrator/organizations/${orgAddress}`,
      { method: 'DELETE' },
    ).catch(handleError)
  }

  // ─── Members (memberbase) ──────────────────────────────────────────────────

  async listMembers(address: string, page?: number): Promise<OrganizationMembersResponse> {
    return this.fetch<OrganizationMembersResponse>(`/organizations/${address}/members`, {
      params: page !== undefined ? { page } : undefined,
    }).catch(handleError)
  }

  /**
   * Add members to the org memberbase. Subject to the plan's member quota.
   * With `{ async: true }` (or when the backend decides a large batch runs
   * async) the response carries a `jobId` — poll it via
   * `client.jobs.waitFor(jobId)` (progress in `job.result.added/total/progress`).
   */
  async addMembers(
    address: string,
    members: OrgMember[],
    opts: { async?: boolean } = {},
  ): Promise<AddMembersResponse> {
    return this.fetch<AddMembersResponse>(`/organizations/${address}/members`, {
      method: 'POST',
      params: opts.async !== undefined ? { async: opts.async } : undefined,
      body: { members },
    }).catch(handleError)
  }

  /**
   * Create a member (no `id`, or an unused one) or update one. On an update a
   * field left out keeps its stored value. Resolves to the member's id, not
   * the member — poll any `censusJobIds` via `client.jobs.waitFor(jobId)`.
   */
  async upsertMember(address: string, member: OrgMember): Promise<UpsertOrgMemberResponse> {
    return this.fetch<UpsertOrgMemberResponse>(`/organizations/${address}/members`, {
      method: 'PUT',
      body: member,
    }).catch(handleError)
  }

  async deleteMembers(address: string, body: DeleteMembersRequest): Promise<DeleteMembersResponse> {
    return this.fetch<DeleteMembersResponse>(`/organizations/${address}/members`, {
      method: 'DELETE',
      body,
    }).catch(handleError)
  }

  // ─── Member groups ─────────────────────────────────────────────────────────

  async listGroups(address: string): Promise<OrganizationGroupsResponse> {
    return this.fetch<OrganizationGroupsResponse>(`/organizations/${address}/groups`).catch(
      handleError,
    )
  }

  async createGroup(address: string, body: CreateGroupRequest): Promise<OrganizationGroup> {
    return this.fetch<OrganizationGroup>(`/organizations/${address}/groups`, {
      method: 'POST',
      body,
    }).catch(handleError)
  }

  async getGroup(address: string, groupId: string): Promise<OrganizationGroup> {
    return this.fetch<OrganizationGroup>(`/organizations/${address}/groups/${groupId}`).catch(
      handleError,
    )
  }

  async updateGroup(address: string, groupId: string, body: UpdateGroupRequest): Promise<void> {
    return this.fetch<void>(`/organizations/${address}/groups/${groupId}`, {
      method: 'PUT',
      body,
    }).catch(handleError)
  }

  async deleteGroup(address: string, groupId: string): Promise<void> {
    return this.fetch<void>(`/organizations/${address}/groups/${groupId}`, {
      method: 'DELETE',
    }).catch(handleError)
  }

  async listGroupMembers(address: string, groupId: string): Promise<OrganizationMembersResponse> {
    return this.fetch<OrganizationMembersResponse>(
      `/organizations/${address}/groups/${groupId}/members`,
    ).catch(handleError)
  }

  // ─── Scoped reads ──────────────────────────────────────────────────────────

  async listCensuses(address: string): Promise<OrganizationCensusesResponse> {
    return this.fetch<OrganizationCensusesResponse>(`/organizations/${address}/censuses`).catch(
      handleError,
    )
  }

  async getSubscription(address: string): Promise<OrganizationSubscriptionInfo> {
    return this.fetch<OrganizationSubscriptionInfo>(
      `/organizations/${address}/subscription`,
    ).catch(handleError)
  }

  // ─── Meta ──────────────────────────────────────────────────────────────────

  async getMeta(address: string): Promise<OrganizationMetaResponse> {
    return this.fetch<OrganizationMetaResponse>(`/organizations/${address}/meta`).catch(handleError)
  }

  async addMeta(address: string, body: OrganizationMetaRequest): Promise<void> {
    return this.fetch<void>(`/organizations/${address}/meta`, {
      method: 'POST',
      body,
    }).catch(handleError)
  }

  async updateMeta(address: string, body: OrganizationMetaRequest): Promise<void> {
    return this.fetch<void>(`/organizations/${address}/meta`, {
      method: 'PUT',
      body,
    }).catch(handleError)
  }

  async deleteMeta(address: string): Promise<void> {
    return this.fetch<void>(`/organizations/${address}/meta`, { method: 'DELETE' }).catch(
      handleError,
    )
  }

  // ─── API keys (integrator) ─────────────────────────────────────────────────
  // Admin-only; API keys are integrator-only — the organization at `address`
  // must be enabled as an integrator (see {@link getIntegratorInfo}).

  /** Returns the org's API keys' metadata (never the secret). Admin-only. */
  async listApiKeys(address: string): Promise<ListApiKeysResponse> {
    return this.fetch<ListApiKeysResponse>(`/integrator/organizations/${address}/apikeys`).catch(
      handleError,
    )
  }

  /**
   * Creates an API key for the organization at `address`. The org must be
   * enabled as an integrator. Valid scopes are a subset of: `quota:read`,
   * `managed:read`, `managed:write`, `voting:write`, `members:write`. The
   * response's `secret` (prefixed `vsk_`) is the plaintext key, returned only
   * once — it cannot be retrieved again.
   */
  async createApiKey(address: string, body: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
    return this.fetch<CreateApiKeyResponse>(`/integrator/organizations/${address}/apikeys`, {
      method: 'POST',
      body,
    }).catch(handleError)
  }

  /** Permanently revokes the given API key. Admin-only. */
  async revokeApiKey(address: string, keyId: string): Promise<void> {
    return this.fetch<void>(`/integrator/organizations/${address}/apikeys/${keyId}`, {
      method: 'DELETE',
    }).catch(handleError)
  }

  // ─── Reference data ────────────────────────────────────────────────────────

  async listRoles(): Promise<OrganizationRole[]> {
    return this.fetch<OrganizationRole[]>('/organizations/roles').catch(handleError)
  }

  async listTypes(): Promise<OrganizationType[]> {
    return this.fetch<OrganizationType[]>('/organizations/types').catch(handleError)
  }

  async listPlans(): Promise<SubscriptionPlan[]> {
    return this.fetch<SubscriptionPlan[]>('/plans').catch(handleError)
  }
}
