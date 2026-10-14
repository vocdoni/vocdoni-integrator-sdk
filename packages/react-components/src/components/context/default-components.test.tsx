import { act, render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { defaultComponents } from './default-components'

declare global {
  interface ImportMeta {
    glob(pattern: string[], options: { query: '?raw'; import: 'default'; eager: true }): Record<string, string>
  }
}

const XSS = '<img src=x onerror="window.__xss=1">'
const SCRIPT = '<script>window.__xss=1</script>'

/** Asserts the payload is shown as text and no live markup was created from it. */
const expectInertText = (container: HTMLElement, payload: string) => {
  expect(container.textContent).toContain(payload)
  expect(container.querySelector('img[onerror]')).toBeNull()
  expect(container.querySelector('script')).toBeNull()
  expect(container.querySelectorAll('[onerror]')).toHaveLength(0)
}

const { ElectionDescription, ElectionQuestion, QuestionChoice, QuestionRankChoice, ElectionResults, OrganizationDescription } =
  defaultComponents

describe('default slots render metadata as plain text', () => {
  it('ElectionDescription', () => {
    const { container } = render(<ElectionDescription description={XSS} />)
    expectInertText(container, XSS)
  })

  it('ElectionQuestion', () => {
    // Partial fixture: the slot's full props need a whole Question; only the text-bearing ones matter here.
    const props = {
      title: 'Question',
      description: XSS,
      fields: null,
      tip: null,
      hasExtendedChoices: false,
      selectionMode: 'single',
      layout: 'list',
    } as unknown as ComponentProps<typeof ElectionQuestion>
    const { container } = render(<ElectionQuestion {...props} />)
    expectInertText(container, XSS)
  })

  it('QuestionChoice', () => {
    const props = {
      choice: { value: 0 },
      value: '0',
      label: 'Choice',
      description: XSS,
      controlType: 'radio',
      onSelect: () => {},
    } as unknown as ComponentProps<typeof QuestionChoice>
    const { container } = render(<QuestionChoice {...props} />)
    expectInertText(container, XSS)
  })

  it('QuestionRankChoice', () => {
    const props = {
      choice: { value: 0 },
      value: '0',
      label: 'Choice',
      description: SCRIPT,
      options: [],
      onRank: () => {},
    } as unknown as ComponentProps<typeof QuestionRankChoice>
    const { container } = render(<QuestionRankChoice {...props} />)
    expectInertText(container, SCRIPT)
  })

  it('ElectionResults', () => {
    const { container } = render(
      <ElectionResults
        questions={
          [
            {
              title: 'Question',
              choices: [{ title: 'Choice', votes: '1', percent: '100%', description: XSS }],
            },
          ] as never
        }
      />
    )
    expectInertText(container, XSS)
  })

  it('OrganizationDescription', () => {
    const { container } = render(<OrganizationDescription description={XSS} />)
    expectInertText(container, XSS)
  })
})

describe('PlainText line handling', () => {
  it('renders a <br> between lines and keeps each line as text', () => {
    const { container } = render(<ElectionDescription description={'first <b>line</b>\r\nsecond\nthird'} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.querySelectorAll('br')).toHaveLength(2)
    expect(root.querySelector('b')).toBeNull()
    expect(root.textContent).toBe('first <b>line</b>secondthird')
    expect(root.innerHTML).toContain('&lt;b&gt;line&lt;/b&gt;')
  })

  it.each(['\n', '  \n '])('renders nothing for whitespace-only description %j', (description) => {
    const { container } = render(<ElectionDescription description={description} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.childNodes).toHaveLength(0)
  })

  it('trims surrounding blank lines so they render no <br>', () => {
    const { container } = render(<ElectionDescription description={'\nfirst\nsecond\n'} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.querySelectorAll('br')).toHaveLength(1)
    expect(root.textContent).toBe('firstsecond')
  })
})

describe('server rendering of plain text', () => {
  it('serializes the payload as escaped text and hydrates without errors', async () => {
    const html = renderToString(<ElectionDescription description={XSS} />)
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')

    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const recoverable: unknown[] = []
    try {
      await act(async () => {
        hydrateRoot(container, <ElectionDescription description={XSS} />, {
          onRecoverableError: (e) => recoverable.push(e),
        })
      })
      expect(recoverable).toEqual([])
      expect(errorSpy).not.toHaveBeenCalled()
      expect(container.querySelector('img')).toBeNull()
      expect(container.textContent).toContain(XSS)
    } finally {
      errorSpy.mockRestore()
      document.body.removeChild(container)
    }
  })
})

// Metadata is untrusted, so no source in this package may inject raw HTML.
describe('guard against raw-HTML injection', () => {
  it('no non-test source injects raw HTML', () => {
    const sources = import.meta.glob(['../../**/*.{ts,tsx}', '!../../**/*.test.{ts,tsx}'], {
      query: '?raw',
      import: 'default',
      eager: true,
    })
    const keys = Object.keys(sources)
    // A broken glob would match nothing and pass vacuously.
    expect(keys.some((key) => key.endsWith('default-components.tsx'))).toBe(true)

    const sink = /dangerouslySetInnerHTML|\.(?:inner|outer)HTML\b|insertAdjacentHTML|createContextualFragment|\bsrcDoc\b|document\.write/
    const offenders = keys.filter((key) => sink.test(sources[key]))

    expect(offenders, `offending files: ${offenders.join(', ')}`).toEqual([])
  })
})
