// ─── Client ───────────────────────────────────────────────────────────────────
export {
  ClientProvider,
  useClient,
  type ClientContextValue,
  type ClientProviderProps,
} from './client/ClientProvider'

// ─── Auth ─────────────────────────────────────────────────────────────────────
export {
  AuthProvider,
  useAuth,
  type AuthContextValue,
  type AuthProviderProps,
} from './auth/AuthProvider'

// ─── Organization ─────────────────────────────────────────────────────────────
export {
  OrganizationProvider,
  organizationQueryKeys,
  useOrganization,
  type OrganizationContextValue,
  type OrganizationProviderProps,
  type OrganizationQueryOptions,
} from './organization/OrganizationProvider'

// ─── Election ─────────────────────────────────────────────────────────────────
export {
  ElectionProvider,
  electionQueryKeys,
  PartialVoteError,
  useElection,
  type ElectionContextValue,
  type ElectionProviderBaseProps,
  type ElectionProviderProps,
  type ElectionQueryOptions,
  type ElectionResultsQueryOptions,
  type QuestionVoteStatus,
} from './election/ElectionProvider'

export {
  useElectionAuth,
  type ElectionAuthContextValue,
  type ElectionSignBatchBallot,
  type ElectionSignBatchResult,
  type ElectionSignResult,
} from './election/use-election-auth'

export {
  ActionsProvider,
  useActions,
  type ActionsContextValue,
  type ActionsProviderProps,
} from './election/ActionsProvider'
