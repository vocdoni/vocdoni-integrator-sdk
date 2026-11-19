import { act, fireEvent, renderHook, screen } from '@testing-library/react'
import { type Context, type ReactNode, useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithComponents } from '../../../test-utils'

const electionScope = vi.hoisted(() => ({ context: null as unknown as Context<unknown> }))
vi.mock('@vocdoni/react-providers', async () => {
  const { createContext, useContext } = await import('react')
  electionScope.context = createContext<unknown>(null)
  const read = () => useContext(electionScope.context) as ElectionScope
  return { useElection: read, useElectionAuth: read }
})

import { CspAuthSession, useCspAuthSession } from './CspAuthSession'

type ElectionScope = {
  election: { id: string; census?: { authFields?: string[]; twoFaFields?: string[] } } | null
  connected: boolean
}

const processOne: ElectionScope = {
  election: { id: 'proc-1', census: { authFields: ['memberNumber', 'password'], twoFaFields: ['email'] } },
  connected: false,
}

const mounts = vi.hoisted(() => ({ count: 0 }))

// Reports the session it sees, and advances the flow so a reset is observable.
const Probe = () => {
  const session = useCspAuthSession()
  return (
    <>
      <p data-testid='session'>
        {[
          session.currentStep,
          session.contact.email ?? '-',
          session.processId ?? '-',
          session.authFields.join(','),
          session.twoFaFields.join(','),
        ].join('|')}
      </p>
      <button
        onClick={() => {
          session.setCurrentStep(1)
          session.setContact({ email: 'jane@example.com' })
        }}
      >
        advance
      </button>
    </>
  )
}

const Mounted = ({ children }: { children?: ReactNode }) => {
  useEffect(() => {
    mounts.count++
  }, [])
  return <>{children}</>
}

const renderSession = (scope: ElectionScope, children: ReactNode = <Probe />) => {
  const tree = (value: ElectionScope) => (
    <electionScope.context.Provider value={value}>
      <CspAuthSession>{children}</CspAuthSession>
    </electionScope.context.Provider>
  )
  const view = renderWithComponents(tree(scope))
  return { ...view, setScope: (next: ElectionScope) => view.rerender(tree(next)) }
}

const session = () => screen.getByTestId('session').textContent

describe('useCspAuthSession', () => {
  it('throws outside a CspAuthSession', () => {
    expect(() => renderHook(() => useCspAuthSession())).toThrow(
      'useCspAuthSession must be used within a <CspAuthSession />',
    )
  })
})

describe('CspAuthSession', () => {
  it('exposes the census fields and the process id', () => {
    renderSession(processOne)
    expect(session()).toBe('0|-|proc-1|memberNumber,password|email')
  })

  it('stays mounted, so its children do not remount, when the election loads', () => {
    mounts.count = 0
    const { setScope } = renderSession(
      { election: null, connected: false },
      <Mounted>
        <Probe />
      </Mounted>,
    )
    expect(mounts.count).toBe(1)

    setScope({ ...processOne, election: processOne.election })
    expect(mounts.count).toBe(1)
    expect(session()).toContain('proc-1')
  })

  it('goes back to step 0 with no stored contact when the voter connects', () => {
    const { setScope } = renderSession(processOne)
    fireEvent.click(screen.getByRole('button', { name: 'advance' }))
    expect(session()).toBe('1|jane@example.com|proc-1|memberNumber,password|email')

    setScope({ ...processOne, connected: true })
    expect(session()).toBe('0|-|proc-1|memberNumber,password|email')
  })

  it('restarts the flow when the process changes', () => {
    const { setScope } = renderSession(processOne)
    fireEvent.click(screen.getByRole('button', { name: 'advance' }))

    act(() => setScope({ election: { id: 'proc-2', census: { authFields: ['name'] } }, connected: false }))

    expect(session()).toBe('0|-|proc-2|name|')
  })
})
