import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { act } from '@testing-library/react'
import type { VotingProcessResponse } from '@vocdoni/api-types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockProcess } from '../../../../mocks/handlers'
import { useProcessStatus } from './use-process-status'

const START = '2026-09-29T09:00:00Z'

/** A process the wire reports live (`READY`) with a scheduled start. */
const scheduled = () =>
  ({
    ...mockProcess,
    startDate: START,
    questions: mockProcess.questions.map((q) => ({ ...q, status: 'READY' })),
  }) as unknown as VotingProcessResponse

const Gate = ({ election }: { election: VotingProcessResponse }) => {
  const status = useProcessStatus(election)
  return (
    <div>
      <span id="badge">{status}</span>
      <button id="btn" disabled={status !== 'ONGOING'}>
        Vote
      </button>
    </div>
  )
}

async function hydrate(html: string) {
  const container = document.createElement('div')
  container.innerHTML = html
  document.body.appendChild(container)
  const recoverable: string[] = []
  await act(async () => {
    hydrateRoot(container, <Gate election={scheduled()} />, {
      onRecoverableError: (e) => recoverable.push(String((e as Error).message)),
    })
  })
  return { container, recoverable, btn: container.querySelector('#btn') as HTMLButtonElement }
}

describe('server rendering across the scheduled start', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('converges on the open state when the start elapses between render and hydration', async () => {
    // The status is derived from a clock, so server and client can legitimately
    // disagree: the start passes while the HTML is in flight, or a cache serves
    // pre-start HTML afterwards. What must hold is that hydration repairs it,
    // or the voter keeps a disabled button after voting opened.
    vi.setSystemTime(new Date('2026-09-29T08:59:59Z'))
    const html = renderToString(<Gate election={scheduled()} />)
    expect(html).toContain('UPCOMING')
    expect(html).toContain('disabled')

    vi.setSystemTime(new Date('2026-09-29T09:00:05Z'))
    const { container, recoverable, btn } = await hydrate(html)

    expect(container.querySelector('#badge')!.textContent).toBe('ONGOING')
    // The attribute is repaired too, not only the text — that is the guarantee.
    expect(btn.disabled).toBe(false)
    expect(btn.getAttribute('disabled')).toBeNull()

    // Not free: React reports one recoverable error and regenerates the tree on
    // the client. Pinned so a React upgrade turning this harsher is caught here.
    expect(recoverable).toHaveLength(1)
  })

  it('hydrates cleanly once the start has passed on both sides', async () => {
    vi.setSystemTime(new Date('2026-09-29T09:00:05Z'))
    const html = renderToString(<Gate election={scheduled()} />)
    expect(html).toContain('ONGOING')

    const { recoverable, btn } = await hydrate(html)
    expect(recoverable).toHaveLength(0)
    expect(btn.disabled).toBe(false)
  })
})
