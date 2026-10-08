import { createContext, useContext } from 'react'
import { linkifyIpfs } from '../shared/ipfs'

/**
 * Maps an election media URL, exactly as the election metadata carries it
 * (e.g. `ipfs://…` or `https://…`), to the URL to render. Return `undefined`
 * while the media is not ready (e.g. still being fetched and verified): the
 * components then render a placeholder instead of the image. Return the URL
 * unchanged for media you do not manage.
 *
 * Lets an app render the exact bytes it verified, e.g. by answering with a
 * `blob:` URL of the downloaded and hash-checked file.
 */
export type MediaUrlResolver = (url: string) => string | undefined

/** The default resolver: every URL is ready as-is. */
export const identityMediaUrl: MediaUrlResolver = (url) => url

export const MediaUrlResolverContext = createContext<MediaUrlResolver>(identityMediaUrl)

/**
 * The media URL resolver of the nearest `ComponentsProvider` (the identity
 * when there is none, or it was given no `resolveMediaUrl`).
 */
export const useResolveMediaUrl = (): MediaUrlResolver => useContext(MediaUrlResolverContext)

/** A media URL after resolution: what to render, or that it is not ready yet. */
export type ResolvedMedia = {
  /** The URL to render (`ipfs://` mapped to a gateway); absent while pending or when there is no media. */
  src?: string
  /** True when there is media but the resolver reported it not ready. */
  pending: boolean
}

/**
 * Resolve one media URL. No URL means no media (not pending); a resolved
 * `ipfs://` URL goes through the IPFS gateway, any other URL (`https:`,
 * `blob:`, `data:`) is used as-is.
 */
export const resolveMedia = (url: string | undefined, resolve: MediaUrlResolver = identityMediaUrl): ResolvedMedia => {
  if (!url) return { pending: false }
  const resolved = resolve(url)
  return resolved === undefined ? { pending: true } : { src: linkifyIpfs(resolved), pending: false }
}
