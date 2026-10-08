// @vitest-environment node
import { sha256 as nobleSha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import {
  auditElectionMetadata,
  auditProcessMetadata,
  getListedQuestionElections,
  hasIntegrityIssues,
  hasMetadataUpdates,
} from './audit'
import { type FetchLike, sha256Hex } from './common'

const GATEWAY = 'https://gateway.example/v2'
const ELECTION_ID = 'f39c69dabbf5335bd7d53130ad823a71b7ba9834'

const baseMetadata = {
  version: '1.2',
  title: { default: 'Board election', es: 'Elección de la junta' },
  description: { default: 'Choose the new board for the next term.' },
  media: { header: 'https://media.example/header.png', streamUri: '' },
  meta: { mediaHashes: { 'https://media.example/header.png': 'aa'.repeat(32) } },
  questions: [
    {
      title: { default: 'Who should chair the board?' },
      description: { default: '' },
      choices: [
        { title: { default: 'Alice' }, value: 0 },
        { title: { default: 'Bob' }, value: 1 },
      ],
    },
  ],
  type: { name: 'single-choice-multiquestion', properties: {} },
}

const sha256 = (text: string) => bytesToHex(nobleSha256(new TextEncoder().encode(text)))

type Routes = Record<string, { status?: number; body: string } | Error>

const createFetch = (routes: Routes) =>
  vi.fn(async (url: string) => {
    const route = routes[url]
    if (!route) return { ok: false, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }
    if (route instanceof Error) throw route
    const bytes = new TextEncoder().encode(route.body)
    return {
      ok: (route.status ?? 200) < 400,
      json: async () => JSON.parse(route.body),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    }
  })

const historyUrl = `${GATEWAY}/elections/${ELECTION_ID}/metadata/history`
const options = (fetch: FetchLike) => ({ vochainApiUrl: GATEWAY, fetch })

const version = (url: string, body: string, overrides: Record<string, unknown> = {}) => ({
  metadataURL: url,
  metadataHash: sha256(body),
  blockHeight: 100,
  txIndex: 0,
  txHash: 'ab'.repeat(32),
  timestamp: '2026-01-01T10:00:00Z',
  ...overrides,
})

describe('sha256Hex', () => {
  it('hashes the exact bytes', async () => {
    const text = '{"title":"x"}'
    expect(await sha256Hex(new TextEncoder().encode(text))).toBe(sha256(text))
  })
})

describe('auditElectionMetadata', () => {
  const v1 = JSON.stringify(baseMetadata)
  const v2 = JSON.stringify({ ...baseMetadata, description: { default: 'Choose the new board for the next terms.' } })

  it('verifies a single creation version and reports no updates', async () => {
    const fetchImpl = createFetch({
      [historyUrl]: { body: JSON.stringify({ versions: [version('https://store.example/v1', v1)] }) },
      'https://store.example/v1': { body: v1 },
    })

    const audit = await auditElectionMetadata(ELECTION_ID, options(fetchImpl))

    expect(audit.available).toBe(true)
    expect(hasMetadataUpdates(audit)).toBe(false)
    expect(hasIntegrityIssues(audit)).toBe(false)
    expect(audit.versions).toEqual([
      {
        metadataURL: 'https://store.example/v1',
        expectedHash: sha256(v1),
        actualHash: sha256(v1),
        blockHeight: 100,
        txHash: 'ab'.repeat(32),
        timestamp: new Date('2026-01-01T10:00:00Z'),
        status: 'verified',
        changes: null,
        questionElections: null,
      },
    ])
  })

  it('diffs each verified version against the previous one', async () => {
    const fetchImpl = createFetch({
      [historyUrl]: {
        body: JSON.stringify({
          versions: [
            version('https://store.example/v1', v1),
            version('https://store.example/v2', v2, { blockHeight: 120, timestamp: '2026-01-01T12:00:00Z' }),
          ],
        }),
      },
      'https://store.example/v1': { body: v1 },
      'https://store.example/v2': { body: v2 },
    })

    const audit = await auditElectionMetadata(ELECTION_ID, options(fetchImpl))

    expect(hasMetadataUpdates(audit)).toBe(true)
    expect(audit.versions[1]).toMatchObject({
      blockHeight: 120,
      status: 'verified',
      changes: [
        {
          field: 'description',
          lang: 'default',
          before: 'Choose the new board for the next term.',
          after: 'Choose the new board for the next terms.',
        },
      ],
    })
  })

  it('flags a document that does not match its recorded hash and does not diff it', async () => {
    const tampered = JSON.stringify({ ...baseMetadata, title: { default: 'Something else' } })
    const fetchImpl = createFetch({
      [historyUrl]: {
        body: JSON.stringify({
          versions: [version('https://store.example/v1', v1), version('https://store.example/v2', v2)],
        }),
      },
      'https://store.example/v1': { body: v1 },
      'https://store.example/v2': { body: tampered },
    })

    const audit = await auditElectionMetadata(ELECTION_ID, options(fetchImpl))

    expect(hasIntegrityIssues(audit)).toBe(true)
    expect(audit.versions[1]).toMatchObject({
      status: 'mismatch',
      expectedHash: sha256(v2),
      actualHash: sha256(tampered),
      changes: null,
    })
  })

  it('flags unreachable versions, including non-http URLs', async () => {
    const fetchImpl = createFetch({
      [historyUrl]: {
        body: JSON.stringify({
          versions: [
            version('ipfs://bafy', v1),
            version('https://store.example/v2', v2),
            version('https://store.example/v3', v2),
          ],
        }),
      },
      'https://store.example/v2': new Error('network'),
      'https://store.example/v3': { status: 404, body: '' },
    })

    const audit = await auditElectionMetadata(ELECTION_ID, options(fetchImpl))

    expect(audit.versions.map((entry) => entry.status)).toEqual(['unverifiable', 'unverifiable', 'unverifiable'])
    expect(audit.versions.map((entry) => entry.reason)).toEqual(['unsupported-url', 'fetch-failed', 'fetch-failed'])
    expect(audit.versions.map((entry) => entry.changes)).toEqual([null, null, null])
  })

  it('reads versions without a recorded hash or a located transaction as unverifiable', async () => {
    const fetchImpl = createFetch({
      [historyUrl]: {
        body: JSON.stringify({
          versions: [
            {
              metadataURL: 'https://store.example/v1',
              blockHeight: 0,
              txIndex: 0,
              timestamp: '0001-01-01T00:00:00Z',
            },
          ],
        }),
      },
      'https://store.example/v1': { body: v1 },
    })

    const audit = await auditElectionMetadata(ELECTION_ID, options(fetchImpl))

    expect(audit.versions[0]).toMatchObject({ status: 'no-hash', actualHash: sha256(v1), blockHeight: 0, timestamp: null })
    expect(audit.versions[0].expectedHash).toBeUndefined()
    expect(audit.versions[0].txHash).toBeUndefined()
    expect(hasIntegrityIssues(audit)).toBe(false)
  })

  it('reads the question elections a parent election lists from its latest trusted version', async () => {
    const parentV1 = JSON.stringify({ ...baseMetadata, questions: [], meta: { questionElections: ['0xAB01', 'ab02'] } })
    const parentV2 = JSON.stringify({ ...baseMetadata, questions: [], meta: { questionElections: ['ab01', 'ab03'] } })
    const fetchImpl = createFetch({
      [historyUrl]: {
        body: JSON.stringify({
          versions: [
            version('https://store.example/p1', parentV1),
            // Recorded with another hash than the document served, so its list is not trusted.
            version('https://store.example/p2', 'something else'),
          ],
        }),
      },
      'https://store.example/p1': { body: parentV1 },
      'https://store.example/p2': { body: parentV2 },
    })

    const audit = await auditElectionMetadata(ELECTION_ID, options(fetchImpl))

    expect(audit.versions.map((entry) => entry.questionElections)).toEqual([['ab01', 'ab02'], null])
    expect(getListedQuestionElections(audit)).toEqual(['ab01', 'ab02'])
  })

  it('reports no listed question elections for a document without the list', async () => {
    const fetchImpl = createFetch({
      [historyUrl]: { body: JSON.stringify({ versions: [version('https://store.example/v1', v1)] }) },
      'https://store.example/v1': { body: v1 },
    })

    const audit = await auditElectionMetadata(ELECTION_ID, options(fetchImpl))

    expect(getListedQuestionElections(audit)).toBeNull()
  })

  it('reports the history as unavailable when the gateway cannot serve it', async () => {
    const audit = await auditElectionMetadata(ELECTION_ID, options(createFetch({})))

    expect(audit).toEqual({ electionId: ELECTION_ID, available: false, versions: [] })
  })

  it('reports the history as unavailable when the request fails', async () => {
    const audit = await auditElectionMetadata(ELECTION_ID, options(createFetch({ [historyUrl]: new Error('offline') })))

    expect(audit.available).toBe(false)
  })
})

describe('auditProcessMetadata', () => {
  const PARENT_ID = 'aa00'
  const parentDoc = JSON.stringify({ ...baseMetadata, questions: [], meta: { questionElections: ['0xAB02', 'ab01'] } })
  const questionDoc = JSON.stringify(baseMetadata)
  const history = (id: string, url: string, body: string) => ({
    [`${GATEWAY}/elections/${id}/metadata/history`]: { body: JSON.stringify({ versions: [version(url, body)] }) },
    [url]: { body },
  })

  it('audits the parent first, then the question elections it lists, then any it does not list', async () => {
    const fetchImpl = createFetch({
      ...history(PARENT_ID, 'https://store.example/parent', parentDoc),
      ...history('ab01', 'https://store.example/q1', questionDoc),
      ...history('ab02', 'https://store.example/q2', questionDoc),
      ...history('ab03', 'https://store.example/q3', questionDoc),
    })

    const audit = await auditProcessMetadata(
      { upstreamId: '0xAA00', questions: [{ upstreamId: 'ab01' }, { upstreamId: 'AB03' }, {}] },
      options(fetchImpl)
    )

    expect(audit.process).toMatchObject({ electionId: PARENT_ID, available: true })
    expect(audit.questions.map((entry) => [entry.electionId, entry.available])).toEqual([
      ['ab02', true],
      ['ab01', true],
      ['ab03', true],
    ])
  })

  it('audits the questions alone for a process without a parent election', async () => {
    const fetchImpl = createFetch(history('ab01', 'https://store.example/q1', questionDoc))

    const audit = await auditProcessMetadata({ questions: [{ upstreamId: 'ab01' }] }, options(fetchImpl))

    expect(audit.process).toBeNull()
    expect(audit.questions.map((entry) => entry.electionId)).toEqual(['ab01'])
  })
})
