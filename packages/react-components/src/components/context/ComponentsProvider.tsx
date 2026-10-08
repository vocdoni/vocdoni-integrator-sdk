import { createContext, ReactNode, useMemo } from 'react'
import { defaultComponents } from './default-components'
import { identityMediaUrl, MediaUrlResolver, MediaUrlResolverContext } from './media'
import { ComponentsDefinition, ComponentsPartialDefinition } from './types'

export const ComponentsContext = createContext<ComponentsDefinition | undefined>(undefined)

export type ComponentsProviderProps = {
  components?: ComponentsPartialDefinition
  /**
   * Resolves every election media URL (header, choice images and thumbnails,
   * result images) before it is rendered; see {@link MediaUrlResolver}.
   * Defaults to the identity. Components re-render when this function
   * changes, so pass a new function (e.g. from `useCallback` keyed on your
   * cache state) whenever a URL's resolution changes.
   */
  resolveMediaUrl?: MediaUrlResolver
  children: ReactNode
}

export const ComponentsProvider = ({ components, resolveMediaUrl, children }: ComponentsProviderProps) => {
  const merged = useMemo(() => ({ ...defaultComponents, ...(components || {}) }), [components])

  return (
    <ComponentsContext.Provider value={merged}>
      <MediaUrlResolverContext.Provider value={resolveMediaUrl ?? identityMediaUrl}>
        {children}
      </MediaUrlResolverContext.Provider>
    </ComponentsContext.Provider>
  )
}
