import { ComponentPropsWithoutRef } from 'react'
import { resolveMedia, useResolveMediaUrl } from '../context/media'
import { useComponents } from '../context/useComponents'
import { useElection } from '@vocdoni/react-providers'
import { getElectionTitle } from '../../election/normalized'

export const ElectionHeader = (props: ComponentPropsWithoutRef<'img'>) => {
  const { election } = useElection()
  const { ElectionHeader: Slot } = useComponents()
  const resolveMediaUrl = useResolveMediaUrl()

  if (!election) return null

  const header = resolveMedia(election.header || undefined, resolveMediaUrl)
  return (
    <Slot
      {...props}
      src={header.src}
      pending={header.pending || undefined}
      alt={getElectionTitle(election)}
    />
  )
}
