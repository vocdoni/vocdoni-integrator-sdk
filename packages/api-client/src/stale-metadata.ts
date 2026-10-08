import { StaleMetadataError } from './errors'
import { JobFailedError } from './jobs'

/**
 * The Vochain's rejection of a vote whose envelope metadata hash differs from
 * the election's current one ("vote metadata hash … does not match the
 * election metadata hash …").
 */
const CHAIN_STALE_METADATA = /metadata hash.*does not match the election metadata hash/i

/** True when `text` is the chain's stale-metadata vote rejection. */
export function isStaleMetadataMessage(text: string | undefined): boolean {
  return !!text && CHAIN_STALE_METADATA.test(text)
}

/**
 * True when a vote was refused because the ballot the voter was shown is out of
 * date: the election metadata (and so its hash) changed since the process was
 * read. The fix is to reload the process, show the voter the new ballot text,
 * and build the vote again with the fresh `metadataHash`.
 *
 * Recognizes the relay's {@link StaleMetadataError} (nothing relayed), a
 * {@link JobFailedError} of a vote relay job where any envelope failed for this
 * reason, and any other error carrying the chain's rejection text.
 */
export function isStaleMetadataError(err: unknown): boolean {
  if (err instanceof StaleMetadataError) return true
  if (err instanceof JobFailedError) {
    const { errors, result } = err.job
    return (
      (errors ?? []).some(isStaleMetadataMessage) ||
      (result?.votes ?? []).some((vote) => isStaleMetadataMessage(vote.error))
    )
  }
  return err instanceof Error && isStaleMetadataMessage(err.message)
}
