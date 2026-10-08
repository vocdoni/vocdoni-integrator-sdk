import type { QuestionStatus, VotingProcessResultsResponse } from '@vocdoni/api-types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeProcess, makeResults, renderWithComponents } from '../../test-utils'

const state = vi.hoisted(() => ({
  election: null as ReturnType<typeof makeProcess> | null,
  status: null as QuestionStatus | null,
  results: null as VotingProcessResultsResponse | null,
}))
vi.mock('@vocdoni/react-providers', () => ({ useElection: () => state }))

import { getQuestionChoiceMeta } from '../Election/Questions/Choice'
import { ElectionHeader } from '../Election/Header'
import { ElectionResults } from '../Election/Results'
import { defaultComponents } from './default-components'
import { resolveMedia, type MediaUrlResolver } from './media'

const VERIFIED: Record<string, string> = {
  'ipfs://header': 'blob:verified-header',
  'https://cdn.example/full.jpeg': 'blob:verified-full',
}
/** Resolves the verified URLs to blobs; everything else is still pending. */
const resolver: MediaUrlResolver = (url) => VERIFIED[url]

describe('resolveMedia', () => {
  it('passes the URL through the resolver, then the IPFS gateway', () => {
    expect(resolveMedia('ipfs://bafy')).toEqual({ src: 'https://infura-ipfs.io/ipfs/bafy', pending: false })
    expect(resolveMedia('ipfs://header', resolver)).toEqual({ src: 'blob:verified-header', pending: false })
  })

  it('reports pending when the resolver answers undefined, and no media for no URL', () => {
    expect(resolveMedia('https://cdn.example/other.jpeg', resolver)).toEqual({ pending: true })
    expect(resolveMedia(undefined, resolver)).toEqual({ pending: false })
  })

  it('hands the resolver the URL exactly as the metadata carries it', () => {
    const seen: string[] = []
    resolveMedia('ipfs://bafy', (url) => {
      seen.push(url)
      return url
    })
    expect(seen).toEqual(['ipfs://bafy'])
  })
})

describe('getQuestionChoiceMeta with a resolver', () => {
  const choice = {
    title: { default: 'A' },
    value: 0,
    meta: { image: { default: 'https://cdn.example/full.jpeg', thumbnail: 'https://cdn.example/t.jpeg' } },
  }

  it('resolves each image size, flagging the ones not ready yet', () => {
    expect(getQuestionChoiceMeta(choice, resolver).image).toEqual({
      default: 'blob:verified-full',
      thumbnail: undefined,
      pending: true,
    })
  })

  it('keeps an image entry while every size is pending, so layouts do not shift', () => {
    expect(getQuestionChoiceMeta(choice, () => undefined).image).toEqual({
      default: undefined,
      thumbnail: undefined,
      pending: true,
    })
  })
})

describe('ElectionHeader', () => {
  const Slot = ({ src, pending }: any) => <div data-testid='header' data-src={src} data-pending={String(!!pending)} />

  it('renders the resolved header URL', () => {
    state.election = { ...makeProcess(), header: 'ipfs://header' }
    renderWithComponents(<ElectionHeader />, { components: { ElectionHeader: Slot }, resolveMediaUrl: resolver })
    expect(screen.getByTestId('header')).toHaveAttribute('data-src', 'blob:verified-header')
    expect(screen.getByTestId('header')).toHaveAttribute('data-pending', 'false')
  })

  it('flags a header the resolver has not made ready', () => {
    state.election = { ...makeProcess(), header: 'https://cdn.example/unverified.png' }
    renderWithComponents(<ElectionHeader />, { components: { ElectionHeader: Slot }, resolveMediaUrl: resolver })
    expect(screen.getByTestId('header')).not.toHaveAttribute('data-src')
    expect(screen.getByTestId('header')).toHaveAttribute('data-pending', 'true')
  })

  it('renders a placeholder from the default slot while pending', () => {
    state.election = { ...makeProcess(), header: 'https://cdn.example/unverified.png' }
    const { container } = renderWithComponents(<ElectionHeader />, { resolveMediaUrl: resolver })
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[data-media-pending]')).not.toBeNull()
  })
})

describe('ElectionResults', () => {
  it('resolves choice images and flags the pending ones', () => {
    let captured: any
    const Slot = (props: any) => {
      captured = props
      return null
    }
    state.election = makeProcess({
      questions: [
        {
          title: 'Q1',
          choices: [
            { title: 'A', value: 0, meta: { image: { default: 'https://cdn.example/full.jpeg' } } },
            { title: 'B', value: 1, meta: { image: { default: 'https://cdn.example/other.jpeg' } } },
          ],
        },
      ],
    })
    state.status = 'RESULTS'
    state.results = makeResults([{ results: [['1', '2']] }])
    renderWithComponents(<ElectionResults />, { components: { ElectionResults: Slot }, resolveMediaUrl: resolver })

    const [a, b] = captured.questions[0].choices
    expect(a.image).toBe('blob:verified-full')
    expect(a.imagePending).toBeUndefined()
    expect(b.image).toBeUndefined()
    expect(b.imagePending).toBe(true)
  })
})

describe('default QuestionChoice slot', () => {
  it('renders a placeholder for a pending image', () => {
    const Choice = defaultComponents.QuestionChoice
    const { container } = render(
      <Choice
        choice={{ title: 'A', value: 0 }}
        value='0'
        label='A'
        image={{ pending: true }}
        compact={false}
        hasImage
        canOpenImageModal={false}
        presentation='extended'
        selectionMode='single'
        selected={false}
        controlType='radio'
        onSelect={() => {}}
      />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[data-media-pending]')).toHaveAttribute('aria-label', 'A')
  })
})
