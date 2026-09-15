import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}

/**
 * True during SSR and the hydration render, false afterwards. Keeps markup that
 * depends on the client's clock or timezone identical on both sides, then
 * settles on the client-specific text once React has attached.
 */
export const useIsHydrationRender = () =>
  useSyncExternalStore(
    subscribe,
    () => false,
    () => true
  )
