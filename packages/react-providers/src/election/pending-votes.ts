import { strip0x } from '@vocdoni/api-voting'

/**
 * A signed vote tx kept in this tab's `sessionStorage` until it is confirmed on
 * chain, so a relay that got lost can be re-sent — the same bytes, with no new
 * CSP signature — after a retry or a reload of the same tab.
 */
export interface PendingVote {
  /** sha256 of the voter's canonical auth0 payload: only that voter may use the entry. */
  owner: string
  /** The vote's nullifier (`voteNullifier(signer.address, upstreamId)`). */
  nullifier: string
  /** The signed tx. Dropped once a blind vote is confirmed (the nullifier stays to re-verify). */
  txPayload?: string
  /** Epoch ms when the tx was built. */
  savedAt: number
  /** Epoch ms when the vote was confirmed on chain. */
  confirmedAt?: number
}

const PREFIX = 'vocdoni.pendingVote.'

const norm = (hex: string) => strip0x(hex).toLowerCase()

// Same shape as AuthProvider's storage helpers: no window → no-op, and any
// storage error (quota, sandboxed iframe, privacy mode) is swallowed. Only
// called from effects and callbacks, never during render.
function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

const keyOf = (electionId: string, nullifier: string) => `${PREFIX}${norm(electionId)}.${norm(nullifier)}`

/** Stores (or replaces) the entry of `electionId` (a question's `upstreamId`) for `entry.nullifier`. */
export function savePendingVote(electionId: string, entry: PendingVote): void {
  try {
    storage()?.setItem(keyOf(electionId, entry.nullifier), JSON.stringify(entry))
  } catch {
    // storage full or unavailable — the vote still relays, it just cannot be recovered
  }
}

export function removePendingVote(electionId: string, nullifier: string): void {
  try {
    storage()?.removeItem(keyOf(electionId, nullifier))
  } catch {
    // ignore
  }
}

/** Every entry stored for `electionId`, whoever owns it. Malformed entries are skipped. */
export function listPendingVotes(electionId: string): PendingVote[] {
  const s = storage()
  if (!s) return []
  const prefix = `${PREFIX}${norm(electionId)}.`
  const out: PendingVote[] = []
  try {
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i)
      if (!key?.startsWith(prefix)) continue
      try {
        const value = JSON.parse(s.getItem(key) ?? '') as PendingVote
        if (typeof value?.owner === 'string' && typeof value.nullifier === 'string') out.push(value)
      } catch {
        // malformed entry — not ours to interpret
      }
    }
  } catch {
    return []
  }
  return out
}

/** Drops every entry of `electionId` (used once its process is over). */
export function clearPendingVotes(electionId: string): void {
  for (const entry of listPendingVotes(electionId)) removePendingVote(electionId, entry.nullifier)
}
