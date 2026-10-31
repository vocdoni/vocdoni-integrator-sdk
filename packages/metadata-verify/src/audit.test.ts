// @vitest-environment node
import { sha256 as nobleSha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import {
  auditElectionMetadata,
  auditProcessMetadata,
  getElectionChildren,
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

  it('reports the history as unavailable when the gateway cannot serve it', async () => {
    const audit = await auditElectionMetadata(ELECTION_ID, options(createFetch({})))

    expect(audit).toEqual({ electionId: ELECTION_ID, available: false, versions: [] })
  })

  it('reports the history as unavailable when the request fails', async () => {
    const audit = await auditElectionMetadata(ELECTION_ID, options(createFetch({ [historyUrl]: new Error('offline') })))

    expect(audit.available).toBe(false)
  })
})

describe('getElectionChildren', () => {
  it('reads every page, oldest first', async () => {
    const page = (n: number, ids: string[], nextPage: number | null) => ({
      [`${GATEWAY}/elections/aa00/children?page=${n}&limit=100`]: {
        body: JSON.stringify({
          elections: ids.map((electionId) => ({ electionId, parentElectionId: 'AA00' })),
          pagination: { totalItems: 3, currentPage: n, nextPage, lastPage: 1 },
        }),
      },
    })
    const fetchImpl = createFetch({ ...page(0, ['ab01', 'ab02'], 1), ...page(1, ['AB03'], null) })

    expect(await getElectionChildren('0xaa00', options(fetchImpl))).toEqual([
      { electionId: 'ab01', parentElectionId: 'aa00' },
      { electionId: 'ab02', parentElectionId: 'aa00' },
      { electionId: 'ab03', parentElectionId: 'aa00' },
    ])
  })
})

describe('auditProcessMetadata', () => {
  const PARENT_ID = 'aa00'
  const parentDoc = JSON.stringify({ ...baseMetadata, questions: [] })
  const questionDoc = JSON.stringify(baseMetadata)
  const history = (id: string, url: string, body: string) => ({
    [`${GATEWAY}/elections/${id}/metadata/history`]: { body: JSON.stringify({ versions: [version(url, body)] }) },
    [url]: { body },
  })
  const election = (id: string, parentElectionId?: string) => ({
    [`${GATEWAY}/elections/${id}`]: { body: JSON.stringify({ electionId: id, parentElectionId }) },
  })
  const children = (parentId: string, list: Array<[string, string?]>) => ({
    [`${GATEWAY}/elections/${parentId}/children?page=0&limit=100`]: {
      body: JSON.stringify({
        elections: list.map(([electionId, parentElectionId]) => ({ electionId, parentElectionId })),
        pagination: { totalItems: list.length, currentPage: 0, nextPage: null, lastPage: 0 },
      }),
    },
  })
  const histories = {
    ...history(PARENT_ID, 'https://store.example/parent', parentDoc),
    ...history('ab01', 'https://store.example/q1', questionDoc),
    ...history('ab02', 'https://store.example/q2', questionDoc),
    ...history('ab03', 'https://store.example/q3', questionDoc),
  }
  const summary = (audit: Awaited<ReturnType<typeof auditProcessMetadata>>) =>
    audit.questions.map((q) => [q.electionId, q.available, q.child, q.inProcess, q.issues])

  it('audits the parent first, then its children oldest first, then any process question it does not have', async () => {
    const fetchImpl = createFetch({
      ...histories,
      ...children(PARENT_ID, [
        ['ab02', PARENT_ID],
        ['ab01', PARENT_ID],
      ]),
      ...election('ab03', 'ffff'),
    })

    const audit = await auditProcessMetadata(
      { upstreamId: '0xAA00', questions: [{ upstreamId: 'ab01' }, { upstreamId: 'AB03' }, {}] },
      options(fetchImpl)
    )

    expect(audit).toMatchObject({ parentElectionId: PARENT_ID, childrenAvailable: true })
    expect(audit.process).toMatchObject({ electionId: PARENT_ID, available: true })
    expect(summary(audit)).toEqual([
      ['ab02', true, true, false, ['not-in-process']],
      ['ab01', true, true, true, []],
      ['ab03', true, false, true, ['wrong-parent', 'not-a-child']],
    ])
  })

  it('finds the parent through a question election when the process does not name it', async () => {
    const fetchImpl = createFetch({
      ...histories,
      ...election('ab01', `0x${PARENT_ID.toUpperCase()}`),
      ...children(PARENT_ID, [['ab01', PARENT_ID]]),
    })

    const audit = await auditProcessMetadata({ questions: [{ upstreamId: 'ab01' }] }, options(fetchImpl))

    expect(audit.parentElectionId).toBe(PARENT_ID)
    expect(audit.process?.available).toBe(true)
    expect(summary(audit)).toEqual([['ab01', true, true, true, []]])
  })

  it('leaves the children unknown, not missing, when the chain cannot list them', async () => {
    const fetchImpl = createFetch({ ...histories, ...election('ab01', PARENT_ID) })

    const audit = await auditProcessMetadata(
      { upstreamId: PARENT_ID, questions: [{ upstreamId: 'ab01' }] },
      options(fetchImpl)
    )

    expect(audit.childrenAvailable).toBe(false)
    expect(summary(audit)).toEqual([['ab01', true, null, true, []]])
  })

  it('audits the questions alone for a process without a parent election', async () => {
    const fetchImpl = createFetch({ ...history('ab01', 'https://store.example/q1', questionDoc), ...election('ab01') })

    const audit = await auditProcessMetadata({ questions: [{ upstreamId: 'ab01' }] }, options(fetchImpl))

    expect(audit).toMatchObject({ parentElectionId: null, process: null, childrenAvailable: false })
    expect(summary(audit)).toEqual([['ab01', true, null, true, []]])
  })
})
