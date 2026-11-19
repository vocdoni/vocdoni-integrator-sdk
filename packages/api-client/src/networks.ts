export type VocdoniNetwork = 'dev' | 'stg' | 'prod'

export interface VocdoniNetworkUrls {
  /** Vochain gateway REST API (v2) */
  gateway: string
  /** Block explorer */
  explorer: string
}

export const VOCDONI_NETWORKS: Readonly<Record<VocdoniNetwork, Readonly<VocdoniNetworkUrls>>> = Object.freeze({
  dev: Object.freeze({ gateway: 'https://api-dev.vocdoni.net/v2', explorer: 'https://dev.explorer.vote' }),
  stg: Object.freeze({ gateway: 'https://api-stg.vocdoni.net/v2', explorer: 'https://stg.explorer.vote' }),
  prod: Object.freeze({ gateway: 'https://api.vocdoni.io/v2', explorer: 'https://explorer.vote' }),
})

const NETWORK_NAMES = Object.keys(VOCDONI_NETWORKS) as VocdoniNetwork[]

/** True for the network names `dev`, `stg` and `prod`. */
export function isVocdoniNetwork(value: unknown): value is VocdoniNetwork {
  return typeof value === 'string' && (NETWORK_NAMES as string[]).includes(value)
}

/**
 * Maps a chain id such as `vocdoni/LTS/1.3` to its network by the second segment
 * (`LTS` → prod, `STAGE`/`STG` → stg, `DEV` → dev). Returns `undefined` for
 * anything else, such as the `TEST` chain: callers decide, nothing falls back to dev.
 */
export function networkFromChainId(chainId: string | null | undefined): VocdoniNetwork | undefined {
  const segment = chainId?.split('/')[1]?.toUpperCase()
  switch (segment) {
    case 'LTS':
      return 'prod'
    case 'STAGE':
    case 'STG':
      return 'stg'
    case 'DEV':
      return 'dev'
    default:
      return undefined
  }
}

/**
 * Resolves a network name (`prod`) or a chain id (`vocdoni/LTS/1.3`) to a network.
 * A name wins over a chain id; `undefined` when neither resolves.
 */
export function resolveNetwork(networkOrChainId: VocdoniNetwork | string | null | undefined): VocdoniNetwork | undefined {
  if (isVocdoniNetwork(networkOrChainId)) return networkOrChainId
  return networkFromChainId(networkOrChainId)
}

/** The explorer base URL of a network, or `undefined` when it does not resolve. */
export function explorerUrl(networkOrChainId: VocdoniNetwork | string | null | undefined): string | undefined {
  const network = resolveNetwork(networkOrChainId)
  return network ? VOCDONI_NETWORKS[network].explorer : undefined
}

/** Explorer page for a vote id. `undefined` when the network does not resolve or the id is empty. */
export function explorerVoteUrl(
  networkOrChainId: VocdoniNetwork | string | null | undefined,
  voteId: string,
): string | undefined {
  const base = explorerUrl(networkOrChainId)
  return base && voteId ? `${base}/verify/${encodeURIComponent(voteId)}` : undefined
}

/**
 * Explorer page for an on-chain election id (a question's `upstreamId`).
 * `undefined` when the network does not resolve or the id is empty.
 */
export function explorerElectionUrl(
  networkOrChainId: VocdoniNetwork | string | null | undefined,
  upstreamId: string,
): string | undefined {
  const base = explorerUrl(networkOrChainId)
  return base && upstreamId ? `${base}/process/${encodeURIComponent(upstreamId)}` : undefined
}

/** Explorer page for an organization address. `undefined` when the network does not resolve or the address is empty. */
export function explorerOrganizationUrl(
  networkOrChainId: VocdoniNetwork | string | null | undefined,
  address: string,
): string | undefined {
  const base = explorerUrl(networkOrChainId)
  return base && address ? `${base}/organization/${encodeURIComponent(address)}` : undefined
}
