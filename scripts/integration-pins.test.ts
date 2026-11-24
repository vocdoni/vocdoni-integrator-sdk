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

function expectOk(input: string, seqRef: string, saasRef: string, sticky: boolean, reset = false) {
  const res = parse(input)
  expect(res.status).toBe(0)
  expect(res.stdout).toBe(
    `vocdoni_sequencer_ref=${seqRef}\nsaas_backend_ref=${saasRef}\nsticky=${sticky}\nreset=${reset}\n`,
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
      expectOk('/integration vocdoni-sequencer=1a2b3c4 saas-backend=abcdef0123', '1a2b3c4', 'abcdef0123', false)
      expectOk('/integration vocdoni-sequencer=1a2b3c4', '1a2b3c4', '', false)
    })

    it('mixed SHA and branch is one-shot', () => {
      expectOk('/integration vocdoni-sequencer=1a2b3c4 saas-backend=main', '1a2b3c4', 'main', false)
    })

    it('a branch ref is sticky', () => {
      expectOk('/integration saas-backend=feat/x.y', '', 'feat/x.y', true)
      expectOk('/integration vocdoni-sequencer=abc', 'abc', '', true)
    })

    it('a #PR ref is accepted and sticky', () => {
      expectOk('/integration saas-backend=#760', '', '#760', true)
      expectOk('/integration vocdoni-sequencer=#1 saas-backend=#999999999', '#1', '#999999999', true)
    })

    it('a bare PR number is output as #N and is sticky', () => {
      expectOk('/integration saas-backend=795', '', '#795', true)
      expectOk('/integration vocdoni-sequencer=1 saas-backend=999999', '#1', '#999999', true)
    })

    it('leading zeros are dropped from a PR number', () => {
      expectOk('/integration saas-backend=0795', '', '#795', true)
      expectOk('/integration saas-backend=#0795', '', '#795', true)
    })

    it('a 7-digit all-numeric ref is a one-shot SHA', () => {
      expectOk('/integration vocdoni-sequencer=1234567', '1234567', '', false)
    })

    it('a bare PR number mixed with a SHA is one-shot', () => {
      expectOk('/integration vocdoni-sequencer=1a2b3c4 saas-backend=795', '1a2b3c4', '#795', false)
    })

    it('a branch with a #PR is sticky', () => {
      expectOk('/integration vocdoni-sequencer=main saas-backend=#760', 'main', '#760', true)
    })

    it('only reads the first line', () => {
      expectOk('/integration vocdoni-sequencer=abc\nsaas-backend=ignored\n/integration bogus!', 'abc', '', true)
    })

    it('strips a CRLF line ending', () => {
      expectOk(
        '/integration vocdoni-sequencer=1a2b3c4 saas-backend=1a2b3c5\r\nmore text\r\n',
        '1a2b3c4',
        '1a2b3c5',
        false,
      )
    })

    it('tolerates extra whitespace and tabs', () => {
      expectOk('/integration   vocdoni-sequencer=1a2b3c4 \t saas-backend=1a2b3c5  ', '1a2b3c4', '1a2b3c5', false)
      expectOk('/integration\tvocdoni-sequencer=1a2b3c4', '1a2b3c4', '', false)
    })

    it('reset clears the sticky state', () => {
      expectOk('/integration reset', '', '', false, true)
      expectOk('/integration reset\nmore text', '', '', false, true)
    })
  })

  describe('rejected comments', () => {
    it('rejects anything that is not the /integration command', () => {
      expectError('/integrationx vocdoni-sequencer=abc')
      expectError('hello')
      expectError('')
    })

    it('rejects an unknown key', () => {
      expectError('/integration vocdoni=abc')
    })

    it('rejects the old vocdoni-node key with a clear error', () => {
      expectError('/integration vocdoni-node=abc')
      const res = parse('/integration vocdoni-node=main')
      expect(res.status).toBe(1)
      expect(res.stderr).toContain('vocdoni-node')
      expect(res.stderr).toContain('vocdoni-sequencer')
    })

    it('rejects a token without =', () => {
      expectError('/integration vocdoni-sequencer')
    })

    it('rejects a key given twice', () => {
      expectError('/integration vocdoni-sequencer=a vocdoni-sequencer=b')
      expectError('/integration saas-backend=a saas-backend=a')
    })

    it('rejects an empty ref', () => {
      expectError('/integration vocdoni-sequencer=')
    })

    it('rejects a ref containing ..', () => {
      expectError('/integration vocdoni-sequencer=a..b')
    })

    it('rejects a ref starting with -', () => {
      expectError('/integration vocdoni-sequencer=-rf')
    })

    it('rejects shell metacharacters', () => {
      expectError('/integration vocdoni-sequencer=a;b')
      expectError('/integration vocdoni-sequencer=$(id)')
    })

    it('rejects malformed #PR refs', () => {
      expectError('/integration vocdoni-sequencer=#')
      expectError('/integration vocdoni-sequencer=#abc')
      expectError('/integration vocdoni-sequencer=#1/2')
      expectError('/integration vocdoni-sequencer=#1234567890')
    })

    it('rejects PR number 0, bare or with #', () => {
      expectError('/integration vocdoni-sequencer=0')
      expectError('/integration vocdoni-sequencer=00')
      expectError('/integration vocdoni-sequencer=#0')
      expectError('/integration vocdoni-sequencer=#000')
    })

    it('rejects reset with any other token', () => {
      expectError('/integration reset vocdoni-sequencer=abc')
      expectError('/integration reset reset')
      expectError('/integration reset foo')
    })
  })
})
