// @vitest-environment node
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'integration-build-image.sh')

// Every case here fails before any network or git call, so the tests never reach GitHub.
// CI sets GITHUB_ACTIONS and may set the deploy key, so both are removed unless passed in.
function run(args: string[], extraEnv: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.GITHUB_ACTIONS
  delete env.SAAS_BACKEND_DEPLOY_KEY
  Object.assign(env, extraEnv)
  const res = spawnSync('bash', [scriptPath, ...args], { env, encoding: 'utf8' })
  return { status: res.status, stdout: res.stdout, stderr: res.stderr }
}

describe('integration-build-image.sh', () => {
  it('rejects an unknown repo', () => {
    const res = run(['vocdoni-saas', 'main'])
    expect(res.status).toBe(1)
    expect(res.stdout).toBe('')
    expect(res.stderr).toMatch(/^ERROR: unknown repo 'vocdoni-saas'/)
  })

  it('rejects an invalid ref', () => {
    for (const ref of ['-rf', 'a..b', 'a;b', '#abc']) {
      const res = run(['vocdoni-node', ref])
      expect(res.status).toBe(1)
      expect(res.stderr).toMatch(/^ERROR: invalid ref/)
    }
  })

  it('exits before any git call when saas-backend has no deploy key in GitHub Actions', () => {
    const envs = [{ GITHUB_ACTIONS: 'true', SAAS_BACKEND_DEPLOY_KEY: '' }, { GITHUB_ACTIONS: 'true' }]
    for (const extraEnv of envs) {
      const res = run(['saas-backend', 'main'], extraEnv)
      expect(res.status).toBe(1)
      expect(res.stdout).toBe('')
      expect(res.stderr).toMatch(/^ERROR: SAAS_BACKEND_DEPLOY_KEY is empty: saas-backend is private/)
      expect(res.stderr.trim().split('\n')).toHaveLength(1)
    }
  })

  it('does not require the deploy key for vocdoni-node', () => {
    const res = run(['vocdoni-node', '-rf'], { GITHUB_ACTIONS: 'true' })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/^ERROR: invalid ref/)
    expect(res.stderr).not.toContain('SAAS_BACKEND_DEPLOY_KEY')
  })
})
