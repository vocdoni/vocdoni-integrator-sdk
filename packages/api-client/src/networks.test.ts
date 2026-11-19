import { describe, expect, it } from 'vitest'
import {
  VOCDONI_NETWORKS,
  explorerElectionUrl,
  explorerOrganizationUrl,
  explorerUrl,
  explorerVoteUrl,
  isVocdoniNetwork,
  networkFromChainId,
  resolveNetwork,
} from './networks'

describe('VOCDONI_NETWORKS', () => {
  it('lists the gateway and explorer of each network', () => {
    expect(VOCDONI_NETWORKS.dev).toEqual({ gateway: 'https://api-dev.vocdoni.net/v2', explorer: 'https://dev.explorer.vote' })
    expect(VOCDONI_NETWORKS.stg).toEqual({ gateway: 'https://api-stg.vocdoni.net/v2', explorer: 'https://stg.explorer.vote' })
    expect(VOCDONI_NETWORKS.prod).toEqual({ gateway: 'https://api.vocdoni.io/v2', explorer: 'https://explorer.vote' })
  })

  it('is frozen', () => {
    expect(Object.isFrozen(VOCDONI_NETWORKS)).toBe(true)
    expect(Object.isFrozen(VOCDONI_NETWORKS.prod)).toBe(true)
  })
})

describe('isVocdoniNetwork', () => {
  it('accepts the network names only', () => {
    expect(isVocdoniNetwork('dev')).toBe(true)
    expect(isVocdoniNetwork('stg')).toBe(true)
    expect(isVocdoniNetwork('prod')).toBe(true)
    expect(isVocdoniNetwork('PROD')).toBe(false)
    expect(isVocdoniNetwork('toString')).toBe(false)
    expect(isVocdoniNetwork('vocdoni/LTS/1.3')).toBe(false)
    expect(isVocdoniNetwork(undefined)).toBe(false)
    expect(isVocdoniNetwork(1)).toBe(false)
  })
})

describe('networkFromChainId', () => {
  it('maps the chain id segment to its network', () => {
    expect(networkFromChainId('vocdoni/LTS/1.3')).toBe('prod')
    expect(networkFromChainId('vocdoni/STAGE/12')).toBe('stg')
    expect(networkFromChainId('vocdoni/STG/12')).toBe('stg')
    expect(networkFromChainId('vocdoni/DEV/36')).toBe('dev')
  })

  it('matches the segment case-insensitively', () => {
    expect(networkFromChainId('vocdoni/lts/1.3')).toBe('prod')
    expect(networkFromChainId('vocdoni/dev/36')).toBe('dev')
  })

  it('matches a whole segment, not a substring', () => {
    expect(networkFromChainId('vocdoni/LTSX/1')).toBeUndefined()
    expect(networkFromChainId('vocdoni/XDEV/1')).toBeUndefined()
  })

  it('returns undefined for unknown, empty or garbage chain ids', () => {
    expect(networkFromChainId('vocdoni/TEST/1')).toBeUndefined()
    expect(networkFromChainId('')).toBeUndefined()
    expect(networkFromChainId(null)).toBeUndefined()
    expect(networkFromChainId(undefined)).toBeUndefined()
    expect(networkFromChainId('garbage')).toBeUndefined()
    expect(networkFromChainId('LTS')).toBeUndefined()
  })
})

describe('resolveNetwork', () => {
  it('takes a network name as is', () => {
    expect(resolveNetwork('stg')).toBe('stg')
  })

  it('falls back to the chain id', () => {
    expect(resolveNetwork('vocdoni/LTS/1.3')).toBe('prod')
  })

  it('returns undefined when neither resolves', () => {
    expect(resolveNetwork('vocdoni/TEST/1')).toBeUndefined()
    expect(resolveNetwork(null)).toBeUndefined()
  })
})

describe('explorer links', () => {
  it('builds the explorer base URL', () => {
    expect(explorerUrl('prod')).toBe('https://explorer.vote')
    expect(explorerUrl('vocdoni/DEV/36')).toBe('https://dev.explorer.vote')
    expect(explorerUrl('vocdoni/TEST/1')).toBeUndefined()
  })

  it('builds vote links under /verify', () => {
    expect(explorerVoteUrl('prod', 'abc123')).toBe('https://explorer.vote/verify/abc123')
    expect(explorerVoteUrl('vocdoni/STAGE/12', 'abc123')).toBe('https://stg.explorer.vote/verify/abc123')
  })

  it('builds election links under /process', () => {
    expect(explorerElectionUrl('dev', 'f00d')).toBe('https://dev.explorer.vote/process/f00d')
  })

  it('builds organization links under /organization', () => {
    expect(explorerOrganizationUrl('prod', '0xabc')).toBe('https://explorer.vote/organization/0xabc')
  })

  it('encodes the id', () => {
    expect(explorerVoteUrl('prod', 'a/b?c')).toBe('https://explorer.vote/verify/a%2Fb%3Fc')
  })

  it('returns undefined when the network does not resolve', () => {
    expect(explorerVoteUrl('vocdoni/TEST/1', 'abc')).toBeUndefined()
    expect(explorerElectionUrl(null, 'abc')).toBeUndefined()
    expect(explorerOrganizationUrl(undefined, '0xabc')).toBeUndefined()
  })

  it('returns undefined when the id is empty', () => {
    expect(explorerVoteUrl('prod', '')).toBeUndefined()
    expect(explorerElectionUrl('prod', '')).toBeUndefined()
    expect(explorerOrganizationUrl('prod', '')).toBeUndefined()
  })
})
