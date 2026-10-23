// @vitest-environment node
import { sha256 as nobleSha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import type { VotingProcessResponse } from '@vocdoni/api-types'
import { type FetchLike, ResourceTooLargeError, compareHash, normalizeHex, readMediaHashes, sha256Hex } from './common'
import {
  type ChainElectionInfo,
  type DisplayedProcess,
  type DisplayedQuestion,
  type FieldCheck,
  compareProcessContent,
  compareQuestionContent,
  displayedImages,
  embeddedImageUrls,
  localizedMatches,
  summarize,
  verifyProcessMetadata,
} from './verify'

const encode = (text: string) => new TextEncoder().encode(text)
const nodeHash = (bytes: Uint8Array) => bytesToHex(nobleSha256(bytes))

const GATEWAY = 'https://vochain.example/v2'
const HEADER = 'https://cdn.example.org/header.png'
const VIDEO = 'https://www.youtube.com/watch?v=abc'
const IMAGE = 'https://cdn.example.org/choice.png'

const headerBytes = encode('header-image-bytes')
const imageBytes = encode('choice-image-bytes')

type World = {
  chain: Record<string, ChainElectionInfo | Error>
  files: Record<string, Uint8Array | Error>
}

/**
 * A `fetch` serving the world: the Vochain API's election reads, and every other URL's bytes.
 * Every Vochain API request is recorded in `chainCalls`.
 */
const fetchFor =
  (world: World, fetched: string[] = [], chainCalls: string[] = []): FetchLike =>
  async (url) => {
    const electionsPrefix = `${GATEWAY}/elections/`
    if (url.startsWith(GATEWAY)) chainCalls.push(url)
    if (url.startsWith(electionsPrefix)) {
      const info = world.chain[url.slice(electionsPrefix.length)]
      if (info instanceof Error) throw info
      if (!info) return new Response('not found', { status: 404 })
      return new Response(JSON.stringify(info), { headers: { 'content-type': 'application/json' } })
    }
    fetched.push(url)
    const file = world.files[url]
    if (!file || file instanceof Error) throw file ?? new TypeError('Failed to fetch')
    return new Response(new Uint8Array(file))
  }

/** What the SaaS API serves for `shown`: each election's metadata URL and hash, as the world committed them. */
const withCommitments = (shown: DisplayedProcess, world: World): DisplayedProcess => {
  const commitment = (id?: string) => {
    const info = id ? world.chain[id] : undefined
    return !info || info instanceof Error ? {} : { metadataURL: info.metadataURL, metadataHash: info.metadataHash }
  }
  return {
    ...shown,
    ...commitment(shown.upstreamId),
    questions: shown.questions?.map((q) => ({ ...q, ...commitment(q.upstreamId) })),
  }
}

/** The default mode: commitments from the SaaS API, no Vochain API configured at all. */
const verify = (shown: DisplayedProcess, world: World, fetched?: string[]) =>
  verifyProcessMetadata(withCommitments(shown, world), { fetch: fetchFor(world, fetched) })

/** The independent mode: commitments from the Vochain API only. */
const verifyIndependent = (shown: DisplayedProcess, world: World, fetched?: string[]) =>
  verifyProcessMetadata(shown, { independent: true, vochainApiUrl: GATEWAY, fetch: fetchFor(world, fetched) })

const ORG = '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567'
const PARENT = 'p0'
const PARENT_URL = 'https://saas.example.org/storage/parent.json'
const questionUrl = (id: string) => `https://saas.example.org/storage/${id}.json`

const question = (upstreamId: string): DisplayedQuestion => ({
  upstreamId,
  title: { default: `Who should chair board ${upstreamId}?`, es: `¿Quién preside la junta ${upstreamId}?` },
  choices: [
    {
      title: { default: 'Alice', es: 'Alicia' },
      value: 0,
      meta: { image: { default: IMAGE }, description: 'Chair since 2024.' },
    },
    { title: { default: 'Bob', es: 'Roberto' }, value: 1 },
  ],
})

/** What the page shows, as read from the SaaS API. */
/** `upstreamId: null` is a process published without a parent election. */
const shownProcess = (ids: string[] = ['e1'], upstreamId: string | null = PARENT): DisplayedProcess => ({
  upstreamId: upstreamId ?? undefined,
  title: { default: 'Board election', es: 'Elección de la junta' },
  description: { default: 'Choose the chair.' },
  header: HEADER,
  streamUri: VIDEO,
  questions: ids.map(question),
})

/** The backend hashes every image it publishes: the header in the parent document... */
const headerHashes = () => ({ [HEADER]: nodeHash(headerBytes) })
/** ...and each choice image in its question's. */
const choiceImageHashes = () => ({ [IMAGE]: nodeHash(imageBytes) })

/** The parent election's document saas-backend writes for `process`. */
const parentDoc = (
  process: DisplayedProcess,
  { mediaHashes = headerHashes() }: { mediaHashes?: Record<string, string> } = {}
) => ({
  title: process.title,
  version: '1.0',
  description: process.description,
  media: { header: process.header, streamUri: process.streamUri },
  meta: { mediaHashes },
  questions: [],
  type: { name: 'single-choice-multiquestion', properties: null },
})

/** The document saas-backend writes for one question: each choice's display entry as its `meta`. */
const questionDoc = (
  q: DisplayedQuestion,
  { mediaHashes = choiceImageHashes() }: { mediaHashes?: Record<string, string> } = {}
) => ({
  title: q.title,
  version: '1.0',
  description: null,
  meta: { mediaHashes },
  questions: [
    {
      title: q.title,
      description: q.description ?? null,
      choices: q.choices!.map(({ title, value, meta }) => ({ title, value, ...(meta ? { meta } : {}) })),
    },
  ],
  type: { name: 'single-choice-multiquestion', properties: null },
})

const encodeDoc = (doc: unknown) => encode(JSON.stringify(doc))

/**
 * A world where every election of `process` committed the document built for it: `docs`
 * overrides the bytes served (keyed by election id) without touching the committed hash.
 */
const committedWorld = (
  process: DisplayedProcess,
  {
    parent = parentDoc(process),
    questionDocs = {},
    served = {},
    files = {},
    parents = {},
  }: {
    parent?: unknown
    /** Document committed for a question election, keyed by its id (default: `questionDoc`). */
    questionDocs?: Record<string, unknown>
    served?: Record<string, Uint8Array>
    files?: World['files']
    /** The parent a question election links to on chain, keyed by its id (default: the process's). */
    parents?: Record<string, string | undefined>
  } = {}
): World => {
  const world: World = { chain: {}, files: { [HEADER]: headerBytes, [IMAGE]: imageBytes, ...files } }
  const add = (id: string, url: string, doc: Uint8Array, link: Partial<ChainElectionInfo>) => {
    world.chain[id] = { organizationId: ORG, metadataURL: url, metadataHash: nodeHash(doc), ...link }
    world.files[url] = served[id] ?? doc
  }
  if (process.upstreamId) add(process.upstreamId, PARENT_URL, encodeDoc(parent), { metadataOnly: true })
  for (const q of process.questions ?? []) {
    if (q.upstreamId) {
      const parentElectionId = q.upstreamId in parents ? parents[q.upstreamId] : process.upstreamId
      add(q.upstreamId, questionUrl(q.upstreamId), encodeDoc(questionDocs[q.upstreamId] ?? questionDoc(q)), {
        parentElectionId,
      })
    }
  }
  return world
}

const mismatches = (fields?: FieldCheck[]) => (fields ?? []).filter((f) => f.status === 'mismatch')

describe('hash helpers', () => {
  it('hashes bytes as lowercase hex SHA-256, matching node', async () => {
    const bytes = encode('hello vocdoni')
    expect(await sha256Hex(bytes)).toBe(nodeHash(bytes))
    expect(await sha256Hex(encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('normalizes case and 0x prefix, and treats blank as absent', () => {
    expect(normalizeHex('0xABcd')).toBe('abcd')
    expect(normalizeHex('0XABcd')).toBe('abcd')
    expect(normalizeHex('  ')).toBeUndefined()
    expect(normalizeHex(undefined)).toBeUndefined()
  })

  it('compares against the committed hash', () => {
    expect(compareHash('abcd', 'ABCD')).toBe('verified')
    expect(compareHash('abcd', '0xabce')).toBe('mismatch')
    expect(compareHash('abcd', '')).toBe('no-hash')
    expect(compareHash(undefined, 'abcd')).toBe('unverifiable')
  })

  it('reads only string media hashes', () => {
    expect(readMediaHashes({ meta: { mediaHashes: { [HEADER]: 'AB', bad: 3 } } })).toEqual({ [HEADER]: 'ab' })
    expect(readMediaHashes({ meta: 'nope' })).toEqual({})
    expect(readMediaHashes(undefined)).toEqual({})
  })
})

describe('displayedImages', () => {
  const THUMB = 'https://cdn.example.org/choice-thumb.png'

  it('collects the header and choice images in both shapes, once each, with their question', () => {
    const published: DisplayedQuestion = {
      upstreamId: 'e1',
      choices: [{ meta: { image: { default: IMAGE, thumbnail: THUMB } } }, { meta: { image: HEADER } }, {}],
    }
    const images = displayedImages({ header: HEADER, streamUri: VIDEO, questions: [published] })

    // The video is not an image: its content is never hashed.
    expect(images).toEqual([{ url: HEADER }, { url: IMAGE, question: published }, { url: THUMB, question: published }])
  })

  it('skips draft questions, which nothing commits', () => {
    expect(displayedImages({ questions: [{ choices: [{ meta: { image: IMAGE } }] }] })).toEqual([])
  })
})

describe('summarize', () => {
  const doc = (status: 'verified' | 'mismatch' | 'unverifiable' | 'no-hash') => ({ electionId: 'e', status })
  const noParent = { status: 'unverifiable' as const, reason: 'no-parent' as const }

  it('reports verified only when the parent and every question are', () => {
    expect(summarize(doc('verified'), [doc('verified'), doc('verified')], [])).toBe('verified')
    expect(summarize(doc('unverifiable'), [doc('verified')], [])).toBe('unverifiable')
    expect(summarize(doc('verified'), [doc('verified'), doc('no-hash')], [])).toBe('unverifiable')
  })

  it('does not hold back a verified ballot for a process published without a parent', () => {
    expect(summarize(noParent, [doc('verified')], [])).toBe('verified')
  })

  it('lets any mismatch win, parent, questions or media', () => {
    expect(summarize(doc('mismatch'), [doc('verified')], [])).toBe('mismatch')
    expect(summarize(doc('verified'), [doc('verified'), doc('mismatch')], [])).toBe('mismatch')
    expect(summarize(doc('verified'), [doc('verified')], [{ url: HEADER, coverage: 'content', committed: true, status: 'mismatch' }])).toBe(
      'mismatch'
    )
  })

  it('does not downgrade a verified ballot for an image nothing commits', () => {
    expect(
      summarize(
        doc('verified'),
        [doc('verified')],
        [{ url: IMAGE, coverage: 'content', committed: false, status: 'unverifiable', reason: 'not-committed' }]
      )
    ).toBe('verified')
  })

  it('reports no-hash when nothing was committed', () => {
    expect(summarize(doc('no-hash'), [doc('no-hash'), doc('no-hash')], [])).toBe('no-hash')
    expect(summarize(noParent, [doc('no-hash')], [])).toBe('no-hash')
  })
})

describe('localizedMatches', () => {
  it('compares every language the document has', () => {
    expect(localizedMatches({ default: 'Hi', es: 'Hola' }, { default: 'Hi', es: 'Hola' })).toBe(true)
    expect(localizedMatches({ default: 'Hi', es: 'Ola' }, { default: 'Hi', es: 'Hola' })).toBe(false)
    expect(localizedMatches({ default: 'Hi' }, { default: 'Hi', es: 'Hola' })).toBe(false)
  })

  it('treats a plain string as the default language', () => {
    expect(localizedMatches('Hi', { default: 'Hi' })).toBe(true)
  })

  it('matches missing text only against no text', () => {
    expect(localizedMatches(undefined, null)).toBe(true)
    expect(localizedMatches({ default: '' }, {})).toBe(true)
    expect(localizedMatches({ default: 'Extra' }, null)).toBe(false)
  })
})

describe('compareProcessContent', () => {
  it('verifies the process fields against a matching parent document', () => {
    const process = shownProcess(['e1', 'e2'])
    const fields = compareProcessContent(process, parentDoc(process))

    expect(fields.map((f) => f.field)).toEqual([
      'process-title',
      'process-description',
      'header',
      'stream',
    ])
    expect(mismatches(fields)).toEqual([])
  })

  it('names each differing process field', () => {
    const process = shownProcess()
    const shown = {
      ...process,
      description: { default: 'Choose the chair now.' },
      streamUri: 'https://other.example/v',
    }

    expect(mismatches(compareProcessContent(shown, parentDoc(process)))).toEqual([
      { field: 'process-description', status: 'mismatch' },
      { field: 'stream', status: 'mismatch' },
    ])
  })
})

describe('compareQuestionContent', () => {
  const statusOf = (fields: FieldCheck[], field: string, choice?: number) =>
    fields.find((f) => f.field === field && f.choice === choice)?.status

  it('verifies the question and its choices against a matching document', () => {
    const q = question('e1')
    const fields = compareQuestionContent(q, questionDoc(q))

    expect(fields.map((f) => f.field)).toEqual([
      'question-title',
      'question-description',
      'choices',
      'choice-title',
      'choice-value',
      'choice-description',
      'choice-image',
      'choice-title',
      'choice-value',
      'choice-description',
      'choice-image',
    ])
    expect(mismatches(fields)).toEqual([])
  })

  it('compares the choice description and image URLs with the document', () => {
    const q = question('e1')
    const [alice, bob] = q.choices!
    const shown: DisplayedQuestion = {
      ...q,
      choices: [
        { ...alice, meta: { image: { default: IMAGE }, description: 'Chair since 2023.' } },
        { ...bob, meta: { image: { default: 'https://cdn.example.org/bob.png' } } },
      ],
    }

    expect(mismatches(compareQuestionContent(shown, questionDoc(q)))).toEqual([
      { field: 'choice-description', choice: 0, status: 'mismatch' },
      { field: 'choice-image', choice: 1, status: 'mismatch' },
    ])
  })

  it('treats an image URL string as the default image', () => {
    const q = question('e1')
    const doc = questionDoc(q)
    doc.questions[0].choices[0] = {
      ...doc.questions[0].choices[0],
      meta: { image: IMAGE, description: 'Chair since 2024.' },
    }

    expect(mismatches(compareQuestionContent(q, doc))).toEqual([])
  })

  it('names each differing field, in any language', () => {
    const q = question('e1')
    const shown: DisplayedQuestion = {
      ...q,
      title: { default: 'Who should chair board e1?', es: 'Otra pregunta' },
      choices: [q.choices![0], { ...q.choices![1], value: 2 }],
    }

    expect(mismatches(compareQuestionContent(shown, questionDoc(q)))).toEqual([
      { field: 'question-title', status: 'mismatch' },
      { field: 'choice-value', choice: 1, status: 'mismatch' },
    ])
  })

  it('flags a shown option the document does not have', () => {
    const q = question('e1')
    const shown = { ...q, choices: [...q.choices!, { title: { default: 'Carol' }, value: 2 }] }
    const fields = compareQuestionContent(shown, questionDoc(q))

    expect(statusOf(fields, 'choices')).toBe('mismatch')
    expect(statusOf(fields, 'choice-title', 2)).toBe('mismatch')
    expect(statusOf(fields, 'choice-value', 2)).toBe('mismatch')
  })
})

describe('verifyProcessMetadata', () => {
  it('verifies the parent, every question, and each image against the document that lists it', async () => {
    const process = shownProcess(['e1', 'e2'])
    const parent = parentDoc(process, { mediaHashes: { [HEADER]: nodeHash(headerBytes).toUpperCase() } })
    const world = committedWorld(process, { parent })

    const result = await verify(process, world)

    expect(result.status).toBe('verified')
    expect(result.process).toMatchObject({ electionId: PARENT, status: 'verified' })
    expect(result.process.fields?.every((f) => f.status === 'verified')).toBe(true)
    expect(result.documents.map((d) => [d.electionId, d.status])).toEqual([
      ['e1', 'verified'],
      ['e2', 'verified'],
    ])
    expect(result.media).toEqual([
      expect.objectContaining({ url: HEADER, committed: true, status: 'verified' }),
      expect.objectContaining({ url: IMAGE, committed: true, status: 'verified' }),
    ])
    // The verified bytes are kept, so the page renders exactly what was hashed.
    expect(Array.from(new Uint8Array(result.media[0].bytes!))).toEqual(Array.from(headerBytes))
  })

  it('never hashes the video, only covers its URL through the parent document', async () => {
    const process = shownProcess()
    const fetched: string[] = []

    const result = await verify(process, committedWorld(process), fetched)

    expect(fetched).not.toContain(VIDEO)
    expect(result.media.map((m) => m.url)).not.toContain(VIDEO)
    expect(result.process.fields?.find((f) => f.field === 'stream')?.status).toBe('verified')
  })

  it('reports a header the verified parent does not list as a mismatch', async () => {
    const process = shownProcess()
    const parent = parentDoc(process, { mediaHashes: {} })

    const result = await verify(process, committedWorld(process, { parent }))

    expect(result.status).toBe('mismatch')
    expect(result.media[0]).toEqual({ coverage: 'content', url: HEADER, committed: true, status: 'mismatch', reason: 'not-listed' })
  })

  it('checks a choice image against its question document, not the parent', async () => {
    const process = shownProcess()
    // The parent listing the choice image does not help: its question document must.
    const parent = parentDoc(process, { mediaHashes: { ...headerHashes(), ...choiceImageHashes() } })
    const questionDocs = { e1: questionDoc(process.questions![0], { mediaHashes: {} }) }

    const result = await verify(process, committedWorld(process, { parent, questionDocs }))

    expect(result.status).toBe('mismatch')
    expect(result.media[1]).toEqual({ coverage: 'content', url: IMAGE, committed: true, status: 'mismatch', reason: 'not-listed' })
  })

  it('reports a choice image whose bytes changed as a mismatch', async () => {
    const process = shownProcess()
    const world = committedWorld(process, { files: { [IMAGE]: encode('another photo') } })

    const result = await verify(process, world)

    expect(result.status).toBe('mismatch')
    expect(result.media[1]).toMatchObject({ url: IMAGE, status: 'mismatch' })
    expect(result.media[1].bytes).toBeUndefined()
  })

  it('leaves a choice image uncommitted when its election committed no hash', async () => {
    const process = shownProcess(['e1'], null)
    const world = committedWorld(process)
    world.chain.e1 = { organizationId: ORG, metadataURL: questionUrl('e1') }

    const result = await verify(process, world)

    expect(result.media[1]).toEqual({ coverage: 'content', url: IMAGE, committed: false, status: 'unverifiable', reason: 'not-committed' })
  })

  it('reports a mismatch when the page shows other question text than the hash-verified document', async () => {
    const process = shownProcess()
    const world = committedWorld(process)
    const shown = shownProcess()
    shown.questions![0].choices![0].title = { default: 'Mallory', es: 'Alicia' }

    const result = await verify(shown, world)

    expect(result.status).toBe('mismatch')
    expect(result.documents[0].status).toBe('mismatch')
    expect(mismatches(result.documents[0].fields)).toEqual([{ field: 'choice-title', choice: 0, status: 'mismatch' }])
  })

  it('reports a mismatch when the page shows another process title than the parent document', async () => {
    const process = shownProcess()
    const world = committedWorld(process)

    const result = await verify({ ...process, title: { default: 'Other' } }, world)

    expect(result.status).toBe('mismatch')
    expect(mismatches(result.process.fields)).toEqual([{ field: 'process-title', status: 'mismatch' }])
  })

  it('reads no Vochain API in the default mode, and checks the SaaS-provided hashes', async () => {
    const process = shownProcess(['e1', 'e2'])
    const world = committedWorld(process)
    const chainCalls: string[] = []

    const result = await verifyProcessMetadata(withCommitments(process, world), {
      vochainApiUrl: GATEWAY,
      fetch: fetchFor(world, [], chainCalls),
    })

    expect(result.status).toBe('verified')
    expect(chainCalls).toEqual([])
    expect(result.process.fields?.map((f) => f.field)).not.toContain('parent-link')
  })

  it('reports a mismatch when the SaaS API serves a hash the document does not have', async () => {
    const process = shownProcess()
    const world = committedWorld(process)
    const shown = withCommitments(process, world)
    shown.questions![0].metadataHash = 'ab'.repeat(32)

    const result = await verifyProcessMetadata(shown, { fetch: fetchFor(world) })

    expect(result.status).toBe('mismatch')
    expect(result.documents[0]).toMatchObject({ status: 'mismatch', expectedHash: 'ab'.repeat(32) })
  })

  it('reads the commitments from the chain in independent mode, ignoring the SaaS-provided ones', async () => {
    const process = shownProcess(['e1', 'e2'])
    const world = committedWorld(process)
    const shown = withCommitments(process, world)
    shown.questions![0].metadataHash = 'ab'.repeat(32)
    const chainCalls: string[] = []

    const result = await verifyProcessMetadata(shown, {
      independent: true,
      vochainApiUrl: GATEWAY,
      fetch: fetchFor(world, [], chainCalls),
    })

    expect(result.status).toBe('verified')
    expect(chainCalls).toHaveLength(3)
    expect(result.process.fields?.find((f) => f.field === 'parent-link')?.status).toBe('verified')
  })

  it('reports a mismatch in independent mode when a question election links to another parent', async () => {
    const process = shownProcess(['e1', 'e2'])
    const world = committedWorld(process, { parents: { e2: 'ffff' } })

    const result = await verifyIndependent(process, world)

    expect(result.status).toBe('mismatch')
    expect(mismatches(result.process.fields)).toEqual([{ field: 'parent-link', status: 'mismatch' }])
  })

  it('reports a mismatch in independent mode when a question election links to no parent', async () => {
    const process = shownProcess()
    const world = committedWorld(process, { parents: { e1: undefined } })

    const result = await verifyIndependent(process, world)

    expect(mismatches(result.process.fields)).toEqual([{ field: 'parent-link', status: 'mismatch' }])
  })

  it('accepts in independent mode the parent id written differently', async () => {
    const process = shownProcess(['e1'], 'ab01')
    const world = committedWorld(process, { parents: { e1: '0xAB01' } })

    const result = await verifyIndependent(process, world)

    expect(result.status).toBe('verified')
  })

  it('leaves the process fields and media not verifiable for a process without a parent', async () => {
    const process = shownProcess(['e1'], null)
    const world = committedWorld(process, { files: { [HEADER]: headerBytes } })

    const result = await verify(process, world)

    expect(result.status).toBe('verified')
    expect(result.process).toMatchObject({ status: 'unverifiable', reason: 'no-parent' })
    expect(result.process.fields?.map((f) => [f.field, f.status])).toEqual([
      ['process-title', 'unverifiable'],
      ['process-description', 'unverifiable'],
      ['header', 'unverifiable'],
      ['stream', 'unverifiable'],
    ])
    expect(result.media[0]).toEqual({ coverage: 'content', url: HEADER, committed: false, status: 'unverifiable', reason: 'no-parent' })
    // Choice images are committed by their question election, parent or not.
    expect(result.media[1]).toMatchObject({ url: IMAGE, committed: true, status: 'verified' })
  })

  it('flags a parent whose bytes differ from its committed hash, and ignores its media list', async () => {
    const process = shownProcess()
    const tampered = encodeDoc(parentDoc(process, { mediaHashes: { [HEADER]: nodeHash(encode('other header')) } }))
    const world = committedWorld(process, { served: { [PARENT]: tampered }, files: { [HEADER]: headerBytes } })

    const result = await verify(process, world)

    expect(result.status).toBe('mismatch')
    expect(result.process.status).toBe('mismatch')
    expect(result.process.fields).toBeUndefined()
    expect(result.media[0]).toEqual({
      coverage: 'content',
      url: HEADER,
      committed: true,
      status: 'unverifiable',
      reason: 'document-unverified',
    })
  })

  it('flags a question document whose bytes differ from its committed hash', async () => {
    const process = shownProcess()
    const world = committedWorld(process, { served: { e1: encode('something else') } })

    const result = await verify(process, world)

    expect(result.status).toBe('mismatch')
    expect(result.documents[0]).toMatchObject({ status: 'mismatch' })
    expect(result.documents[0].fields).toBeUndefined()
  })

  it('flags a medium whose bytes changed', async () => {
    const process = shownProcess()
    const parent = parentDoc(process, { mediaHashes: { [HEADER]: nodeHash(encode('original header')) } })
    const world = committedWorld(process, { parent })

    const result = await verify(process, world)

    expect(result.status).toBe('mismatch')
    expect(result.media[0]).toMatchObject({ url: HEADER, status: 'mismatch', actualHash: nodeHash(headerBytes) })
  })

  it('reports an image blocked by CORS as not verifiable, without bytes to render', async () => {
    const process = shownProcess()
    const world = committedWorld(process, { files: { [HEADER]: new TypeError('Failed to fetch') } })

    const result = await verify(process, world)

    expect(result.status).toBe('verified')
    expect(result.media[0]).toMatchObject({ status: 'unverifiable', reason: 'fetch-failed' })
    expect(result.media[0].bytes).toBeUndefined()
  })

  it('reports no-hash for elections that committed none, without fetching their metadata', async () => {
    const fetched: string[] = []
    const world: World = {
      chain: { [PARENT]: { organizationId: ORG, metadataURL: PARENT_URL }, e1: { organizationId: ORG } },
      files: {},
    }
    const process = { ...shownProcess(), header: undefined, streamUri: undefined, questions: [{ upstreamId: 'e1' }] }

    const result = await verify(process, world, fetched)

    expect(result.status).toBe('no-hash')
    expect(fetched).toEqual([])
  })

  it('skips questions that are not published', async () => {
    const process = { ...shownProcess([], null), questions: [{ title: { default: 'Draft' } }] }

    const result = await verify(process, { chain: {}, files: {} })

    expect(result.documents).toEqual([])
  })

  it('reports unverifiable in independent mode when the chain or a document cannot be read', async () => {
    const world: World = {
      chain: {
        e1: new Error('gateway down'),
        e2: { organizationId: ORG, metadataURL: questionUrl('e2'), metadataHash: 'ab' },
        e3: { organizationId: ORG, metadataURL: 'ipfs://bafy', metadataHash: 'ab' },
      },
      files: { [questionUrl('e2')]: new ResourceTooLargeError(questionUrl('e2')) },
    }

    const result = await verifyIndependent(shownProcess(['e1', 'e2', 'e3'], null), world)

    expect(result.status).toBe('unverifiable')
    expect(result.documents.map((d) => d.reason)).toEqual(['chain-unavailable', 'too-large', 'unsupported-url'])
  })

  it('needs every question verified for a verified headline', async () => {
    const process = shownProcess(['e1', 'e2'])
    const world = committedWorld(process)
    world.chain.e2 = { organizationId: ORG, metadataURL: questionUrl('e2') }

    const result = await verify(process, world)

    expect(result.status).toBe('unverifiable')
  })
})

describe('url-only coverage', () => {
  const EMBEDDED = 'https://cdn.example.org/embedded.png'
  const CHOICE_EMBEDDED = 'https://cdn.example.org/choice-embedded.png'

  it('finds markdown and HTML images in every language, once each', () => {
    expect(
      embeddedImageUrls({
        default: `Intro ![map](${EMBEDDED} "Map") and <img alt="x" src='${CHOICE_EMBEDDED}'>`,
        es: `![mapa](<${EMBEDDED}>)`,
      })
    ).toEqual([EMBEDDED, CHOICE_EMBEDDED])
    expect(embeddedImageUrls('No images [link](https://example.org)')).toEqual([])
    expect(embeddedImageUrls(undefined)).toEqual([])
  })

  it('lists the video and embedded images by URL only, with the status of the text carrying them, never fetching them', async () => {
    const process = shownProcess()
    process.description = { default: `Choose the chair. ![map](${EMBEDDED})` }
    process.questions![0].choices![0].meta!.description = `Chair since 2024. <img src="${CHOICE_EMBEDDED}">`
    const fetched: string[] = []

    const result = await verify(process, committedWorld(process), fetched)

    expect(result.status).toBe('verified')
    expect(result.urlOnly).toEqual([
      { url: VIDEO, kind: 'stream', coverage: 'url-only', field: 'stream', status: 'verified' },
      { url: EMBEDDED, kind: 'embedded', coverage: 'url-only', field: 'process-description', status: 'verified' },
      {
        url: CHOICE_EMBEDDED,
        kind: 'embedded',
        coverage: 'url-only',
        field: 'choice-description',
        question: 0,
        choice: 0,
        status: 'verified',
      },
    ])
    expect(fetched).not.toContain(VIDEO)
    expect(fetched).not.toContain(EMBEDDED)
    expect(fetched).not.toContain(CHOICE_EMBEDDED)
    expect(result.media.every((medium) => medium.coverage === 'content')).toBe(true)
  })

  it('reports an embedded image as mismatching when the text carrying it differs from the document', async () => {
    const process = shownProcess()
    const world = committedWorld(process)
    const shown = { ...process, description: { default: `Choose the chair. ![map](${EMBEDDED})` } }

    const result = await verify(shown, world)

    expect(result.status).toBe('mismatch')
    expect(result.urlOnly.find((medium) => medium.url === EMBEDDED)?.status).toBe('mismatch')
  })

  it('leaves the video not verifiable for a process without a parent', async () => {
    const process = shownProcess(['e1'], null)

    const result = await verify(process, committedWorld(process))

    expect(result.urlOnly).toEqual([
      { url: VIDEO, kind: 'stream', coverage: 'url-only', field: 'stream', status: 'unverifiable' },
    ])
  })
})

describe('input types', () => {
  it('accepts a process as the SaaS API returns it', () => {
    const fromApi = (response: VotingProcessResponse & { upstreamId?: string }): DisplayedProcess => response
    expect(typeof fromApi).toBe('function')
  })
})
