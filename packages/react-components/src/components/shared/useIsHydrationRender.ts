import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}

/**
 * True during server rendering and the client's hydration render, false from
 * the first post-hydration render on. Use it to keep markup that depends on
 * the client's clock or timezone identical on both sides of hydration, then
 * settle on the client-specific text once React has attached.
 */
export const useIsHydrationRender = () =>
  useSyncExternalStore(
    subscribe,
    () => false,
    () => true
  )
