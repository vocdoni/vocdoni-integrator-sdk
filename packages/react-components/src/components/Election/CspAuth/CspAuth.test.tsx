import { hashMemberPassword, VocdoniApiError } from '@vocdoni/api-client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { type Context, type ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { createTestI18n } from '../../../i18n/test-i18n'
import { renderWithComponents } from '../../../test-utils'
import { ComponentsProvider } from '../../context/ComponentsProvider'
import type { ComponentsPartialDefinition } from '../../context/types'

// `useElection` / `useElectionAuth` read a real React context, so one test can nest two elections.
const electionScope = vi.hoisted(() => ({ context: null as unknown as Context<unknown> }))
vi.mock('@vocdoni/react-providers', async () => {
  const { createContext, useContext } = await import('react')
  electionScope.context = createContext<unknown>(null)
  const read = () => useContext(electionScope.context) as ElectionScope
  return { useElection: read, useElectionAuth: read }
})
vi.mock('@vocdoni/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vocdoni/api-client')>()
  return { ...actual, hashMemberPassword: vi.fn(actual.hashMemberPassword) }
})

import { CspAuth } from './CspAuth'
import { CspAuthSession } from './CspAuthSession'

const ORG = '0x00000000000000000000000000000000000000AA'

type ElectionScope = {
  election: {
    id: string
    orgAddress: string
    census: { authFields: string[]; twoFaFields: string[]; certAuth?: boolean }
  } | null
  connected: boolean
  challengePending: boolean
  voting: boolean
  auth0: Mock
  auth1: Mock
  resend: Mock
  clear: Mock
}

const makeScope = (over: Partial<ElectionScope> = {}): ElectionScope => ({
  election: { id: 'proc-1', orgAddress: ORG, census: { authFields: ['memberNumber'], twoFaFields: [] } },
  connected: false,
  // Step 0 leaves the challenge pending; a test clears it to model the app calling clear().
  challengePending: true,
  voting: false,
  auth0: vi.fn(async () => {}),
  auth1: vi.fn(async () => {}),
  resend: vi.fn(async () => {}),
  clear: vi.fn(),
  ...over,
})

const passwordCensus = {
  id: 'proc-1',
  orgAddress: ORG,
  census: { authFields: ['memberNumber', 'password'], twoFaFields: [] },
}

const twoFa = (census: { authFields?: string[]; twoFaFields?: string[] } = {}): ElectionScope['election'] => ({
  id: 'proc-1',
  orgAddress: ORG,
  census: { authFields: ['memberNumber'], twoFaFields: ['phone'], ...census },
})

// Renders `ui` inside the query client and the given election scope; `setScope` re-renders with another one.
const renderCsp = (ui: ReactNode, scope: ElectionScope, components?: ComponentsPartialDefinition) => {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const tree = (value: ElectionScope) => (
    <QueryClientProvider client={queryClient}>
      <electionScope.context.Provider value={value}>{ui}</electionScope.context.Provider>
    </QueryClientProvider>
  )
  const view = renderWithComponents(tree(scope), { components })
  return { ...view, setScope: (next: ElectionScope) => view.rerender(tree(next)) }
}

const deferred = () => {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const fieldNames = () =>
  Array.from(screen.getByRole('dialog').querySelectorAll('input')).map((input) => input.getAttribute('name'))

const openIdentify = () => fireEvent.click(screen.getByRole('button', { name: 'Identify' }))

describe('CspAuth', () => {
  it('renders nothing until the election loads', () => {
    const { container } = renderCsp(<CspAuth />, makeScope({ election: null }))
    expect(container).toBeEmptyDOMElement()
  })

  it('renders one field per auth field with the password always last', () => {
    renderCsp(
      <CspAuth />,
      makeScope({
        election: {
          id: 'proc-1',
          orgAddress: ORG,
          census: { authFields: ['password', 'memberNumber', 'name'], twoFaFields: ['email'] },
        },
      }),
    )
    openIdentify()
    expect(fieldNames()).toEqual(['memberNumber', 'name', 'password', 'contact'])
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText(/^Email/)).toHaveAttribute('type', 'email')
  })

  it('sends the password as its hash, never the plaintext', async () => {
    const scope = makeScope({
      election: passwordCensus,
    })
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: ' 42 ' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 's3cret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }))

    const expected = await hashMemberPassword(ORG, 's3cret')
    await waitFor(() => expect(scope.auth0).toHaveBeenCalledWith({ memberNumber: '42', password: expected }))
    expect(JSON.stringify(scope.auth0.mock.calls)).not.toContain('s3cret')
  })

  it('shows a password-unavailable error and sends nothing when hashing fails', async () => {
    vi.mocked(hashMemberPassword).mockRejectedValueOnce(new Error('no web crypto'))
    const scope = makeScope({
      election: passwordCensus,
    })
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 's3cret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The password cannot be checked right now. Reload the page and try again.',
    )
    expect(scope.auth0).not.toHaveBeenCalled()
  })

  it('routes the contact to email when it contains an @ and both channels are allowed', async () => {
    const scope = makeScope({ election: twoFa({ twoFaFields: ['email', 'phone'] }) })
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Email or Phone'), { target: { value: ' jane@example.com ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Receive Code' }))

    await waitFor(() =>
      expect(scope.auth0).toHaveBeenCalledWith({ memberNumber: '42', email: 'jane@example.com' }),
    )
  })

  it('routes the contact to phone when it has no @ and both channels are allowed', async () => {
    const scope = makeScope({ election: twoFa({ twoFaFields: ['email', 'phone'] }) })
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Email or Phone'), { target: { value: ' +34600000000 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Receive Code' }))

    await waitFor(() => expect(scope.auth0).toHaveBeenCalledWith({ memberNumber: '42', phone: '+34600000000' }))
  })

  it('stays on the identify step for an auth-only census', async () => {
    const scope = makeScope()
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }))

    await waitFor(() => expect(scope.auth0).toHaveBeenCalledTimes(1))
    expect(screen.queryByLabelText('Enter the verification code')).not.toBeInTheDocument()
    expect(screen.queryByText('Verification code sent')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Member Number')).toBeInTheDocument()
  })

  it('moves a 2FA census to the code step with a notice that the code was sent', async () => {
    const scope = makeScope({ election: twoFa() })
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+34600000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Receive Code' }))

    expect(await screen.findByLabelText('Enter the verification code')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Verification code sent')
  })

  it('submits the code once all six digits are typed, keeping only digits', async () => {
    const scope = makeScope({ election: twoFa() })
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+34600000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Receive Code' }))
    const code = await screen.findByLabelText('Enter the verification code')

    fireEvent.change(code, { target: { value: '12a34' } })
    expect(code).toHaveValue('1234')
    fireEvent.change(code, { target: { value: '12345' } })
    expect(scope.auth1).not.toHaveBeenCalled()
    fireEvent.change(code, { target: { value: '123456' } })

    await waitFor(() => expect(scope.auth1).toHaveBeenCalledTimes(1))
    expect(scope.auth1).toHaveBeenCalledWith('123456')
  })

  it('resends the code to the contact captured at step 0', async () => {
    const scope = makeScope({ election: twoFa({ twoFaFields: ['email'] }) })
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Receive Code' }))
    await screen.findByLabelText('Enter the verification code')

    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }))

    await waitFor(() => expect(scope.resend).toHaveBeenCalledWith({ email: 'jane@example.com' }))
    expect(await screen.findByText('Code resent successfully')).toBeInTheDocument()
  })

  it('reports a failed resend inline', async () => {
    const scope = makeScope({ election: twoFa() })
    scope.resend.mockRejectedValueOnce(new VocdoniApiError(429, { code: 40103 }, 'cooldown', 40103))
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+34600000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Receive Code' }))
    await screen.findByLabelText('Enter the verification code')

    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to resend code: Too many requests. Please wait a moment before trying again.',
    )
  })

  it('shows the translated resend detail with its apostrophes, under an escaping i18next', async () => {
    // Default i18next escapes interpolated values; the detail is already translated text, so it must not be escaped.
    const i18n = createTestI18n({ interpolation: { escapeValue: true } })
    const scope = makeScope({ election: twoFa() })
    scope.resend.mockRejectedValueOnce(new VocdoniApiError(403, { code: 40801 }, 'no weight', 40801))
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    render(
      <I18nextProvider i18n={i18n}>
        <ComponentsProvider>
          <QueryClientProvider client={queryClient}>
            <electionScope.context.Provider value={scope}>
              <CspAuth />
            </electionScope.context.Provider>
          </QueryClientProvider>
        </ComponentsProvider>
      </I18nextProvider>,
    )
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+34600000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Receive Code' }))
    await screen.findByLabelText('Enter the verification code')

    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Failed to resend code: You don't have enough voting power to access the election.",
    )
  })

  it('clears the resend notice when a code is submitted', async () => {
    const scope = makeScope({ election: twoFa() })
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+34600000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Receive Code' }))
    const code = await screen.findByLabelText('Enter the verification code')
    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }))
    expect(await screen.findByText('Code resent successfully')).toBeInTheDocument()

    scope.auth1.mockRejectedValueOnce(new VocdoniApiError(400, { code: 40001 }, 'bad code', 40001))
    fireEvent.change(code, { target: { value: '123456' } })

    expect(await screen.findByRole('alert')).toHaveTextContent('The code is not valid or has expired.')
    expect(screen.queryByText('Code resent successfully')).not.toBeInTheDocument()
  })

  it('start over returns to the identify step', async () => {
    const scope = makeScope({ election: twoFa() })
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+34600000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Receive Code' }))
    await screen.findByLabelText('Enter the verification code')

    fireEvent.click(screen.getByRole('button', { name: 'Start over' }))

    expect(screen.queryByLabelText('Enter the verification code')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Member Number')).toBeInTheDocument()
  })

  it('shows the mapped error inline when the identify request fails', async () => {
    const scope = makeScope()
    scope.auth0.mockRejectedValueOnce(new VocdoniApiError(401, { code: 40802 }, 'not found', 40802))
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The voter is not listed in the census, or the provided credentials are incorrect.',
    )
  })

  it('keeps a pending request across closing the dialog, and blocks a second one', async () => {
    const pending = deferred()
    const scope = makeScope()
    scope.auth0.mockReturnValueOnce(pending.promise)
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }))
    await waitFor(() => expect(scope.auth0).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // The trigger reflects the request that outlives the dialog.
    expect(screen.getByRole('button', { name: 'Identify' })).toHaveAttribute('aria-busy', 'true')

    openIdentify()
    expect(screen.getByRole('button', { name: 'Authenticate' })).toBeDisabled()
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
    expect(scope.auth0).toHaveBeenCalledTimes(1)

    await act(async () => pending.resolve())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Identify' })).not.toHaveAttribute('aria-busy'))
  })

  it('keeps the session busy after a process change while an identify is in flight', async () => {
    const pending = deferred()
    const scope = makeScope()
    scope.auth0.mockReturnValueOnce(pending.promise)
    const { setScope } = renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }))
    await waitFor(() => expect(scope.auth0).toHaveBeenCalledTimes(1))

    setScope(makeScope({ election: { id: 'proc-2', orgAddress: ORG, census: { authFields: ['memberNumber'], twoFaFields: [] } } }))

    expect(screen.getByRole('button', { name: 'Authenticate' })).toBeDisabled()
    await act(async () => pending.resolve())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Authenticate' })).toBeEnabled())
  })

  it('sends one identify request for a double submit', async () => {
    const pending = deferred()
    const scope = makeScope()
    scope.auth0.mockReturnValueOnce(pending.promise)
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    const form = screen.getByRole('dialog').querySelector('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)

    await waitFor(() => expect(scope.auth0).toHaveBeenCalledTimes(1))
    await act(async () => pending.resolve())
  })

  it('disables start over and resend while a code request is pending', async () => {
    const pending = deferred()
    const scope = makeScope({ election: twoFa() })
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+34600000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Receive Code' }))
    await screen.findByLabelText('Enter the verification code')

    scope.auth1.mockReturnValueOnce(pending.promise)
    fireEvent.change(screen.getByLabelText('Enter the verification code'), { target: { value: '123456' } })
    await waitFor(() => expect(scope.auth1).toHaveBeenCalledTimes(1))

    expect(screen.getByRole('button', { name: 'Start over' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Resend code' })).toBeDisabled()
    await act(async () => pending.resolve())
  })

  it('shows the logout button when connected and clears the session on click', () => {
    const scope = makeScope({ connected: true })
    renderCsp(<CspAuth />, scope)

    fireEvent.click(screen.getByRole('button', { name: 'Logout' }))

    expect(scope.clear).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Identify' })).not.toBeInTheDocument()
  })

  it('closes the dialog on Escape', () => {
    renderCsp(<CspAuth />, makeScope())
    openIdentify()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the terms passed to it inside the identify form', () => {
    renderCsp(<CspAuth terms={<label>I accept the terms</label>} />, makeScope())
    openIdentify()
    expect(screen.getByText('I accept the terms')).toBeInTheDocument()
  })

  it('shares one step between two CspAuth under the same session', async () => {
    const scope = makeScope({ election: twoFa() })
    renderCsp(
      <CspAuthSession>
        <CspAuth />
        <CspAuth />
      </CspAuthSession>,
      scope,
    )
    const [first, second] = screen.getAllByRole('button', { name: 'Identify' })
    fireEvent.click(first)
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+34600000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Receive Code' }))
    await screen.findByLabelText('Enter the verification code')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    fireEvent.click(second)
    expect(within(screen.getByRole('dialog')).getByLabelText('Enter the verification code')).toBeInTheDocument()
  })

  it('does not reuse an outer session that is scoped to another process', () => {
    const outer = makeScope({ election: twoFa() })
    const inner = makeScope({
      election: { id: 'proc-2', orgAddress: ORG, census: { authFields: ['memberNumber'], twoFaFields: [] } },
    })
    renderCsp(
      <CspAuthSession>
        <electionScope.context.Provider value={inner}>
          <CspAuth />
        </electionScope.context.Provider>
      </CspAuthSession>,
      outer,
    )
    openIdentify()

    // The inner election is auth-only: its own census, not the outer 2FA one, drives the form.
    expect(screen.queryByLabelText('Phone')).not.toBeInTheDocument()
    expect(fieldNames()).toEqual(['memberNumber'])
  })

  it('closes the dialog on an overlay click', () => {
    renderCsp(<CspAuth />, makeScope())
    openIdentify()

    const overlay = document.querySelector('.vocdoni-csp-auth-modal-overlay')!
    fireEvent.mouseDown(overlay)
    fireEvent.click(overlay)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('moves focus into the dialog on open and back to the trigger on close', () => {
    renderCsp(<CspAuth />, makeScope())
    const trigger = screen.getByRole('button', { name: 'Identify' })
    trigger.focus()

    openIdentify()
    expect(screen.getByRole('dialog')).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(trigger).toHaveFocus()
  })

  it('moves focus to the logout button when the voter connects while the dialog is open', () => {
    const scope = makeScope()
    const { setScope } = renderCsp(<CspAuth />, scope)
    const trigger = screen.getByRole('button', { name: 'Identify' })
    trigger.focus()
    openIdentify()

    setScope(makeScope({ connected: true }))

    // The trigger the dialog would return focus to has been replaced by Logout.
    expect(trigger).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Logout' })).toHaveFocus()
  })

  it('shows a rate-limit message with its wait time, through the real translations', async () => {
    const scope = makeScope()
    scope.auth0.mockRejectedValueOnce(
      new VocdoniApiError(429, { code: 40017, data: { retryAfter: 300 } }, 'limited', 40017),
    )
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Please try again in 5 minutes.')
  })

  it('blocks the identify submit until the required terms are accepted', async () => {
    const scope = makeScope()
    renderCsp(<CspAuth requireTerms terms='I accept the terms' />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('You must accept the terms to continue.')
    expect(scope.auth0).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('I accept the terms'))
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }))
    await waitFor(() => expect(scope.auth0).toHaveBeenCalledWith({ memberNumber: '42' }))
  })

  it('keeps only digits from a custom code slot, so non-digits cannot auto-submit', async () => {
    const scope = makeScope({ election: twoFa() })
    const Code = ({ onCodeChange }: { onCodeChange: (code: string) => void }) => (
      <button type='button' onClick={() => onCodeChange('12a4567')}>
        send code
      </button>
    )
    renderCsp(<CspAuth />, scope, { CspAuthCodeForm: Code as never })
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+34600000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Receive Code' }))
    fireEvent.click(await screen.findByRole('button', { name: 'send code' }))

    await waitFor(() => expect(scope.auth1).toHaveBeenCalledWith('124567'))
    expect(scope.auth1).toHaveBeenCalledTimes(1)
  })

  it('throws the password-unavailable error when the election has no org address', async () => {
    const scope = makeScope({
      election: { id: 'proc-1', orgAddress: '', census: { authFields: ['memberNumber', 'password'], twoFaFields: [] } },
    })
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 's3cret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The password cannot be checked right now. Reload the page and try again.',
    )
    expect(scope.auth0).not.toHaveBeenCalled()
  })

  it('shows the code-sent notice once, not again when the dialog reopens on the code step', async () => {
    const scope = makeScope({ election: twoFa() })
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+34600000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Receive Code' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Verification code sent')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    openIdentify()

    expect(screen.getByLabelText('Enter the verification code')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('falls back to the plain resend message when the failure has no detail', async () => {
    const scope = makeScope({ election: twoFa() })
    scope.resend.mockRejectedValueOnce(new Error(''))
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+34600000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Receive Code' }))
    await screen.findByLabelText('Enter the verification code')

    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Failed to resend code')
  })

  it('hands the documented props to the slot overrides', () => {
    const Trigger = vi.fn(() => <button>trigger</button>)
    const Modal = vi.fn(() => null)
    const scope = makeScope()
    renderCsp(<CspAuth className='x' />, scope, { CspAuthTrigger: Trigger as never, CspAuthModal: Modal as never })

    expect(Trigger).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: 'Identify', loading: false, className: 'x', onClick: expect.any(Function) }),
      undefined,
    )
    expect(Modal).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isOpen: false,
        title: 'Authentication',
        closeLabel: 'Close',
        onClose: expect.any(Function),
      }),
      undefined,
    )
  })

  it('hands the documented props to the identify form and code form overrides', async () => {
    const Identify = vi.fn(() => <form />)
    const Code = vi.fn(() => <form />)
    const scope = makeScope({ election: twoFa() })
    renderCsp(<CspAuth />, scope, { CspAuthIdentifyForm: Identify as never, CspAuthCodeForm: Code as never })
    openIdentify()

    expect(Identify).toHaveBeenLastCalledWith(
      expect.objectContaining({
        loading: false,
        submitLabel: 'Receive Code',
        info: expect.any(String),
        fields: [
          expect.objectContaining({ name: 'memberNumber', label: 'Member Number', type: 'text', required: true }),
          expect.objectContaining({ name: 'contact', label: 'Phone', type: 'tel', required: true }),
        ],
        onSubmit: expect.any(Function),
      }),
      undefined,
    )
  })

  it('hands the documented props to the logout slot override', () => {
    const Logout = vi.fn(() => <button>logout</button>)
    renderCsp(<CspAuth />, makeScope({ connected: true }), { CspAuthLogout: Logout as never })
    expect(Logout).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: 'Logout', onClick: expect.any(Function) }),
      undefined,
    )
  })
  it('keeps the dialog open when a drag starts inside it and ends on the overlay', () => {
    renderCsp(<CspAuth />, makeScope())
    openIdentify()

    fireEvent.mouseDown(screen.getByRole('dialog'))
    fireEvent.click(document.querySelector('.vocdoni-csp-auth-modal-overlay')!)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('uses the email input type for an email-only census, also when the dialog reopens', () => {
    renderCsp(<CspAuth />, makeScope({ election: twoFa({ twoFaFields: ['email'] }) }))
    openIdentify()
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    fireEvent.click(screen.getByRole('button', { name: 'Identify' }))
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email')
  })

  it('uses the text input type when both channels are allowed', () => {
    renderCsp(<CspAuth />, makeScope({ election: twoFa({ twoFaFields: ['email', 'phone'] }) }))
    openIdentify()
    expect(screen.getByLabelText('Email or Phone')).toHaveAttribute('type', 'text')
  })

  it('rejects a whitespace-only value as required, without sending it', async () => {
    const scope = makeScope()
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This field is required')
    expect(scope.auth0).not.toHaveBeenCalled()
  })

  it('does not mark a flow busy for a request on another process', async () => {
    const pending = deferred()
    const procA = makeScope({ election: { id: 'proc-A', orgAddress: ORG, census: { authFields: ['memberNumber'], twoFaFields: [] } } })
    const procB = makeScope({ election: { id: 'proc-B', orgAddress: ORG, census: { authFields: ['memberNumber'], twoFaFields: [] } } })
    procA.auth0.mockReturnValueOnce(pending.promise)
    renderCsp(
      <>
        <electionScope.context.Provider value={procA}>
          <CspAuth />
        </electionScope.context.Provider>
        <electionScope.context.Provider value={procB}>
          <CspAuth />
        </electionScope.context.Provider>
      </>,
      procA,
    )
    const [triggerA, triggerB] = screen.getAllByRole('button', { name: 'Identify' })
    fireEvent.click(triggerA)
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }))
    await waitFor(() => expect(procA.auth0).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(triggerB).not.toHaveAttribute('aria-busy')
    fireEvent.click(triggerB)
    expect(screen.getByRole('button', { name: 'Authenticate' })).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }))
    await waitFor(() => expect(procB.auth0).toHaveBeenCalledWith({ memberNumber: '7' }))

    await act(async () => pending.resolve())
  })

  it('gives each ElectionProvider for the same process its own flow', async () => {
    const outer = makeScope({ election: twoFa() })
    const inner = makeScope({
      election: { id: 'proc-1', orgAddress: ORG, census: { authFields: ['memberNumber'], twoFaFields: [] } },
    })
    renderCsp(
      <CspAuthSession>
        <CspAuth />
        <electionScope.context.Provider value={inner}>
          <CspAuth />
        </electionScope.context.Provider>
      </CspAuthSession>,
      outer,
    )
    const [outerTrigger, innerTrigger] = screen.getAllByRole('button', { name: 'Identify' })
    fireEvent.click(outerTrigger)
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+34600000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Receive Code' }))
    await screen.findByLabelText('Enter the verification code')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    // The outer flow is on its code step; the inner provider is auth-only and starts at identify.
    fireEvent.click(innerTrigger)
    expect(screen.queryByLabelText('Enter the verification code')).not.toBeInTheDocument()
    expect(fieldNames()).toEqual(['memberNumber'])
  })

  it('drops the step change of a request that settles after the process changed', async () => {
    const pending = deferred()
    const scope = makeScope({ election: twoFa() })
    scope.auth0.mockReturnValueOnce(pending.promise)
    const { setScope } = renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+34600000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Receive Code' }))
    await waitFor(() => expect(scope.auth0).toHaveBeenCalledTimes(1))

    setScope({ ...scope, election: { ...twoFa()!, id: 'proc-2' } })
    await act(async () => pending.resolve())

    expect(screen.queryByLabelText('Enter the verification code')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Member Number')).toBeInTheDocument()
  })

  it('shows a failure that settles after the dialog closed when it reopens', async () => {
    const pending = deferred()
    const scope = makeScope()
    scope.auth0.mockReturnValueOnce(pending.promise)
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }))
    await waitFor(() => expect(scope.auth0).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await act(async () => pending.reject(new VocdoniApiError(401, { code: 40802 }, 'not found', 40802)))
    openIdentify()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The voter is not listed in the census, or the provided credentials are incorrect.',
    )
  })

  it('submits a complete code typed during a resend once the resend settles', async () => {
    const pending = deferred()
    const scope = makeScope({ election: twoFa() })
    scope.resend.mockReturnValueOnce(pending.promise)
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+34600000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Receive Code' }))
    const code = await screen.findByLabelText('Enter the verification code')

    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }))
    await waitFor(() => expect(scope.resend).toHaveBeenCalledTimes(1))
    fireEvent.change(code, { target: { value: '123456' } })
    expect(scope.auth1).not.toHaveBeenCalled()

    await act(async () => pending.resolve())
    await waitFor(() => expect(scope.auth1).toHaveBeenCalledWith('123456'))
    expect(scope.auth1).toHaveBeenCalledTimes(1)
  })

  it('leaves the code input without a maxLength, so a pasted code is filtered rather than cut', async () => {
    const scope = makeScope({ election: twoFa() })
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+34600000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Receive Code' }))
    const code = await screen.findByLabelText('Enter the verification code')
    expect(code).not.toHaveAttribute('maxLength')

    fireEvent.change(code, { target: { value: '123 456' } })

    await waitFor(() => expect(scope.auth1).toHaveBeenCalledWith('123456'))
  })

  it('tells the voter to start over when a resend hits the per-token resend cap', async () => {
    const scope = makeScope({ election: twoFa() })
    scope.resend.mockRejectedValueOnce(new VocdoniApiError(429, { code: 40017 }, 'limited', 40017))
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+34600000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Receive Code' }))
    await screen.findByLabelText('Enter the verification code')

    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Failed to resend code: You can't request more codes for this attempt. Start over to get a new one.",
    )
  })

  it('tells the voter the code is not valid when the code step rejects it', async () => {
    const scope = makeScope({ election: twoFa() })
    scope.auth1.mockRejectedValueOnce(new VocdoniApiError(401, { code: 40001 }, 'unauthorized', 40001))
    renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+34600000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Receive Code' }))
    const code = await screen.findByLabelText('Enter the verification code')

    fireEvent.change(code, { target: { value: '123456' } })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The code is not valid or has expired. Check it, or start over to get a new one.',
    )
  })

  it('starts over when the app clears the pending challenge on the code step', async () => {
    const scope = makeScope({ election: twoFa() })
    const { setScope } = renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+34600000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Receive Code' }))
    await screen.findByLabelText('Enter the verification code')

    setScope({ ...scope, challengePending: false })

    expect(screen.queryByLabelText('Enter the verification code')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Member Number')).toBeInTheDocument()
  })

  it('renders nothing for a certificate census until the voter is connected', () => {
    const scope = makeScope({
      election: { id: 'proc-1', orgAddress: ORG, census: { authFields: ['nationalId'], twoFaFields: [], certAuth: true } },
    })
    const { container, setScope } = renderCsp(<CspAuth />, scope)
    expect(container).toBeEmptyDOMElement()

    setScope({ ...scope, connected: true })
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }))
    expect(scope.clear).toHaveBeenCalledTimes(1)
  })

  it('does not retry a rejected identify, even with an app-wide mutation retry default', async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: 3 } } })
    const scope = makeScope()
    scope.auth0.mockRejectedValue(new VocdoniApiError(401, { code: 40802 }, 'not found', 40802))
    renderWithComponents(
      <QueryClientProvider client={queryClient}>
        <electionScope.context.Provider value={scope}>
          <CspAuth />
        </electionScope.context.Provider>
      </QueryClientProvider>,
    )
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(scope.auth0).toHaveBeenCalledTimes(1)
  })

  it('keeps the modal slot mounted and tells it isOpen is false once the voter connects', () => {
    const Modal = vi.fn(() => null)
    const scope = makeScope()
    const { setScope } = renderCsp(<CspAuth />, scope, { CspAuthModal: Modal as never })
    openIdentify()
    expect(Modal).toHaveBeenLastCalledWith(expect.objectContaining({ isOpen: true }), undefined)

    setScope({ ...scope, connected: true })

    expect(Modal).toHaveBeenLastCalledWith(expect.objectContaining({ isOpen: false }), undefined)
  })

  it('disables logout while a vote is being sent', () => {
    const scope = makeScope({ connected: true, voting: true })
    const { setScope } = renderCsp(<CspAuth />, scope)
    expect(screen.getByRole('button', { name: 'Logout' })).toBeDisabled()

    setScope({ ...scope, voting: false })

    expect(screen.getByRole('button', { name: 'Logout' })).toBeEnabled()
  })

  it('does not mark a flow busy for a request under another provider of the same process', async () => {
    const pending = deferred()
    const outer = makeScope()
    const inner = makeScope()
    outer.auth0.mockReturnValueOnce(pending.promise)
    renderCsp(
      <>
        <electionScope.context.Provider value={outer}>
          <CspAuth />
        </electionScope.context.Provider>
        <electionScope.context.Provider value={inner}>
          <CspAuth />
        </electionScope.context.Provider>
      </>,
      outer,
    )
    const [outerTrigger, innerTrigger] = screen.getAllByRole('button', { name: 'Identify' })
    fireEvent.click(outerTrigger)
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }))
    await waitFor(() => expect(outer.auth0).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(innerTrigger).not.toHaveAttribute('aria-busy')
    fireEvent.click(innerTrigger)
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }))
    await waitFor(() => expect(inner.auth0).toHaveBeenCalledWith({ memberNumber: '7' }))

    await act(async () => pending.resolve())
  })

  it('clears the identify form when the process changes, keeping the dialog open', () => {
    const scope = makeScope()
    const { setScope } = renderCsp(<CspAuth />, scope)
    openIdentify()
    fireEvent.change(screen.getByLabelText('Member Number'), { target: { value: '42' } })

    setScope({
      ...scope,
      election: { id: 'proc-2', orgAddress: ORG, census: { authFields: ['memberNumber'], twoFaFields: [] } },
    })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Member Number')).toHaveValue('')
  })
})
