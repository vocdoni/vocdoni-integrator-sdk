import { describe, expect, it } from 'vitest'
import { path } from './path'

describe('path', () => {
  it('leaves plain ids and literal parts unchanged', () => {
    const id = '0x00000000000000000000000000000000000000AA'
    expect(path`/processes/${id}/results`).toBe(`/processes/${id}/results`)
    expect(path`/jobs/${'5f1c2a9e8b7d6c5a4b3c2d1e'}`).toBe('/jobs/5f1c2a9e8b7d6c5a4b3c2d1e')
    expect(path`/processes/${'abc-123'}`).toBe('/processes/abc-123')
  })

  it('percent-encodes reserved characters so they stay inside one segment', () => {
    expect(path`/processes/${'../organizations/x'}`).toBe('/processes/..%2Forganizations%2Fx')
    expect(path`/processes/${'a?b=c'}`).toBe('/processes/a%3Fb%3Dc')
    expect(path`/processes/${'a#b'}`).toBe('/processes/a%23b')
    expect(path`/processes/${'100%'}`).toBe('/processes/100%25')
  })

  it('encodes spaces and unicode', () => {
    expect(path`/organizations/${'my org'}`).toBe('/organizations/my%20org')
    expect(path`/organizations/${'ñandú'}`).toBe('/organizations/%C3%B1and%C3%BA')
  })

  it('keeps dots inside a longer value', () => {
    expect(path`/processes/${'a..b'}`).toBe('/processes/a..b')
    expect(path`/processes/${'.hidden'}`).toBe('/processes/.hidden')
  })

  it('converts non-string values with String()', () => {
    expect(path`/processes/${42}/questions/${0}`).toBe('/processes/42/questions/0')
  })

  it('throws a TypeError for an empty value', () => {
    expect(() => path`/processes/${''}`).toThrow(TypeError)
    expect(() => path`/processes/${''}`).toThrow('""')
  })

  it('throws a TypeError for "." and ".."', () => {
    expect(() => path`/processes/${'.'}`).toThrow(TypeError)
    expect(() => path`/processes/${'.'}`).toThrow('"."')
    expect(() => path`/processes/${'..'}/results`).toThrow(TypeError)
    expect(() => path`/processes/${'..'}/results`).toThrow('".."')
  })
})
