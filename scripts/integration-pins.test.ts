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

function expectOk(input: string, nodeRef: string, saasRef: string) {
  const res = parse(input)
  expect(res.status).toBe(0)
  expect(res.stdout).toBe(`vocdoni_node_ref=${nodeRef}\nsaas_backend_ref=${saasRef}\n`)
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
    it('bare /integration pins nothing', () => {
      expectOk('/integration', '', '')
      expectOk('/integration\n', '', '')
    })

    it('accepts both keys', () => {
      expectOk('/integration vocdoni-node=1a2b3c4 saas-backend=main', '1a2b3c4', 'main')
    })

    it('accepts a single key', () => {
      expectOk('/integration vocdoni-node=abc', 'abc', '')
      expectOk('/integration saas-backend=abc', '', 'abc')
    })

    it('accepts refs with slashes and dots', () => {
      expectOk('/integration saas-backend=feat/x.y', '', 'feat/x.y')
    })

    it('only reads the first line', () => {
      expectOk('/integration vocdoni-node=abc\nsaas-backend=ignored\n/integration bogus!', 'abc', '')
    })

    it('strips a CRLF line ending', () => {
      expectOk('/integration vocdoni-node=abc saas-backend=def\r\nmore text\r\n', 'abc', 'def')
    })

    it('tolerates extra whitespace and tabs', () => {
      expectOk('/integration   vocdoni-node=abc \t saas-backend=def  ', 'abc', 'def')
      expectOk('/integration\tvocdoni-node=abc', 'abc', '')
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
  })
})
