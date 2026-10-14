// @vitest-environment node
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'integration-sticky.sh')

type Comment = { body: string; author_association: string }

const OWNER = 'OWNER'

function sticky(comments: Comment[]) {
  const res = spawnSync('bash', [scriptPath], { input: JSON.stringify(comments), encoding: 'utf8' })
  expect(res.status, res.stderr).toBe(0)
  expect(res.stderr).toBe('')
  return res.stdout
}

function refs(node: string, saas: string) {
  return `vocdoni_node_ref=${node}\nsaas_backend_ref=${saas}\n`
}

describe('integration-sticky.sh', () => {
  it('empty array has no sticky state', () => {
    expect(sticky([])).toBe(refs('', ''))
  })

  it('a sticky comment sets the state', () => {
    expect(sticky([{ body: '/integration saas-backend=#760', author_association: OWNER }])).toBe(refs('', '#760'))
  })

  it('a SHA-only comment does not change the state', () => {
    expect(
      sticky([
        { body: '/integration saas-backend=#760', author_association: OWNER },
        { body: '/integration vocdoni-node=1a2b3c4', author_association: OWNER },
      ]),
    ).toBe(refs('', '#760'))
  })

  it('reset clears the state', () => {
    expect(
      sticky([
        { body: '/integration saas-backend=#760', author_association: OWNER },
        { body: '/integration reset', author_association: OWNER },
      ]),
    ).toBe(refs('', ''))
  })

  it('a later sticky comment replaces the earlier one', () => {
    expect(
      sticky([
        { body: '/integration vocdoni-node=feat/a saas-backend=#1', author_association: OWNER },
        { body: '/integration saas-backend=#2', author_association: OWNER },
      ]),
    ).toBe(refs('', '#2'))
  })

  it('ignores sticky comments from non-members', () => {
    expect(
      sticky([
        { body: '/integration vocdoni-node=feat/a', author_association: 'NONE' },
        { body: '/integration vocdoni-node=feat/b', author_association: 'CONTRIBUTOR' },
      ]),
    ).toBe(refs('', ''))
  })

  it('accepts MEMBER and COLLABORATOR authors', () => {
    expect(sticky([{ body: '/integration vocdoni-node=feat/a', author_association: 'MEMBER' }])).toBe(
      refs('feat/a', ''),
    )
    expect(sticky([{ body: '/integration vocdoni-node=feat/a', author_association: 'COLLABORATOR' }])).toBe(
      refs('feat/a', ''),
    )
  })

  it('ignores malformed /integration comments', () => {
    expect(
      sticky([
        { body: '/integration saas-backend=#760', author_association: OWNER },
        { body: '/integration saas-backend=#abc', author_association: OWNER },
        { body: '/integration reset now', author_association: OWNER },
        { body: 'just chatting', author_association: OWNER },
      ]),
    ).toBe(refs('', '#760'))
  })

  it('reads the first line of a multi-line body', () => {
    expect(
      sticky([
        {
          body: '/integration vocdoni-node=feat/a\n\nSome notes with `backticks` and "quotes",\n/integration reset',
          author_association: OWNER,
        },
      ]),
    ).toBe(refs('feat/a', ''))
  })
})
