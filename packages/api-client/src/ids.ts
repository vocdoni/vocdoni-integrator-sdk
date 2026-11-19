const PROCESS_ID = /^[0-9a-f]{24}$/i
const VOCHAIN_ELECTION_ID = /^(0x)?[0-9a-f]{64}$/i
const ORGANIZATION_ADDRESS = /^(0x)?[0-9a-f]{40}$/i

/** A SaaS process id: a Mongo ObjectID, 24 hex chars, no `0x`. */
export function isProcessId(value: unknown): value is string {
  return typeof value === 'string' && PROCESS_ID.test(value)
}

/** An on-chain election id (a question's `upstreamId`): 64 hex chars, optional `0x`. */
export function isVochainElectionId(value: unknown): value is string {
  return typeof value === 'string' && VOCHAIN_ELECTION_ID.test(value)
}

/** A 20-byte organization address: 40 hex chars, optional `0x`. */
export function isOrganizationAddress(value: unknown): value is string {
  return typeof value === 'string' && ORGANIZATION_ADDRESS.test(value)
}

/** The canonical organization address: `0x` + lowercase hex. Idempotent. */
export function normalizeOrganizationAddress(address: string): string {
  return '0x' + address.replace(/^0x/i, '').toLowerCase()
}
