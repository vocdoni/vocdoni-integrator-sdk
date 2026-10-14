// @vitest-environment node
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'integration-pins.sh')

function parse(input: string) {
  const res = spawnSync('bash', [scriptPath], { input, encoding: 'utf8' })
  return { status: res.status, stdout: res.stdout, stderr: res.stderr }
}

function expectOk(input: string, nodeRef: string, saasRef: string, sticky: boolean, reset = false) {
  const res = parse(input)
  expect(res.status).toBe(0)
  expect(res.stdout).toBe(
    `vocdoni_node_ref=${nodeRef}\nsaas_backend_ref=${saasRef}\nsticky=${sticky}\nreset=${reset}\n`,
  )
  expect(res.stderr).toBe('')
}

function expectError(input: string) {
  const res = parse(input)
  expect(res.status).toBe(1)
  expect(res.stdout).toBe('')
  expect(res.stderr).toMatch(/^ERROR: /)
}

describe('integration-pins.sh', () => {
  describe('accepted comments', () => {
    it('bare /integration pins nothing and is one-shot', () => {
      expectOk('/integration', '', '', false)
      expectOk('/integration\n', '', '', false)
    })

    it('SHA-only refs are one-shot', () => {
      expectOk('/integration vocdoni-node=1a2b3c4 saas-backend=abcdef0123', '1a2b3c4', 'abcdef0123', false)
      expectOk('/integration vocdoni-node=1a2b3c4', '1a2b3c4', '', false)
    })

    it('mixed SHA and branch is one-shot', () => {
      expectOk('/integration vocdoni-node=1a2b3c4 saas-backend=main', '1a2b3c4', 'main', false)
    })

    it('a branch ref is sticky', () => {
      expectOk('/integration saas-backend=feat/x.y', '', 'feat/x.y', true)
      expectOk('/integration vocdoni-node=abc', 'abc', '', true)
    })

    it('a #PR ref is accepted and sticky', () => {
      expectOk('/integration saas-backend=#760', '', '#760', true)
      expectOk('/integration vocdoni-node=#1 saas-backend=#999999999', '#1', '#999999999', true)
    })

    it('a branch with a #PR is sticky', () => {
      expectOk('/integration vocdoni-node=main saas-backend=#760', 'main', '#760', true)
    })

    it('only reads the first line', () => {
      expectOk('/integration vocdoni-node=abc\nsaas-backend=ignored\n/integration bogus!', 'abc', '', true)
    })

    it('strips a CRLF line ending', () => {
      expectOk('/integration vocdoni-node=1a2b3c4 saas-backend=1a2b3c5\r\nmore text\r\n', '1a2b3c4', '1a2b3c5', false)
    })

    it('tolerates extra whitespace and tabs', () => {
      expectOk('/integration   vocdoni-node=1a2b3c4 \t saas-backend=1a2b3c5  ', '1a2b3c4', '1a2b3c5', false)
      expectOk('/integration\tvocdoni-node=1a2b3c4', '1a2b3c4', '', false)
    })

    it('reset clears the sticky state', () => {
      expectOk('/integration reset', '', '', false, true)
      expectOk('/integration reset\nmore text', '', '', false, true)
    })
  })

  describe('rejected comments', () => {
    it('rejects anything that is not the /integration command', () => {
      expectError('/integrationx vocdoni-node=abc')
      expectError('hello')
      expectError('')
    })

    it('rejects an unknown key', () => {
      expectError('/integration vocdoni=abc')
    })

    it('rejects a token without =', () => {
      expectError('/integration vocdoni-node')
    })

    it('rejects a key given twice', () => {
      expectError('/integration vocdoni-node=a vocdoni-node=b')
      expectError('/integration saas-backend=a saas-backend=a')
    })

    it('rejects an empty ref', () => {
      expectError('/integration vocdoni-node=')
    })

    it('rejects a ref containing ..', () => {
      expectError('/integration vocdoni-node=a..b')
    })

    it('rejects a ref starting with -', () => {
      expectError('/integration vocdoni-node=-rf')
    })

    it('rejects shell metacharacters', () => {
      expectError('/integration vocdoni-node=a;b')
      expectError('/integration vocdoni-node=$(id)')
    })

    it('rejects malformed #PR refs', () => {
      expectError('/integration vocdoni-node=#')
      expectError('/integration vocdoni-node=#abc')
      expectError('/integration vocdoni-node=#1/2')
      expectError('/integration vocdoni-node=#1234567890')
    })

    it('rejects reset with any other token', () => {
      expectError('/integration reset vocdoni-node=abc')
      expectError('/integration reset reset')
      expectError('/integration reset foo')
    })
  })
})
