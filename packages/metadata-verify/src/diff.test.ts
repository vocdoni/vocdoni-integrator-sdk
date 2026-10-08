import { condenseDiff, diffMetadata, diffWords } from './diff'

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

describe('diffMetadata', () => {
  it('finds no change between equal documents, whatever their key order', () => {
    const reordered = JSON.parse(JSON.stringify({ ...baseMetadata, version: '1.2' }))
    const { title, ...rest } = reordered
    expect(diffMetadata(baseMetadata, { ...rest, title })).toEqual([])
  })

  it('reports multi-language title and description changes per language', () => {
    const changes = diffMetadata(baseMetadata, {
      ...baseMetadata,
      title: { default: 'Board election', es: 'Elección del consejo', ca: 'Elecció de la junta' },
      description: 'Choose the new board for the next two terms.',
    })

    expect(changes).toEqual([
      { field: 'title', lang: 'ca', before: null, after: 'Elecció de la junta' },
      { field: 'title', lang: 'es', before: 'Elección de la junta', after: 'Elección del consejo' },
      {
        field: 'description',
        lang: 'default',
        before: 'Choose the new board for the next term.',
        after: 'Choose the new board for the next two terms.',
      },
    ])
  })

  it('reports media URLs and media hashes', () => {
    const changes = diffMetadata(baseMetadata, {
      ...baseMetadata,
      media: { header: 'https://media.example/header.png', streamUri: 'https://video.example/v' },
      meta: { mediaHashes: { 'https://media.example/header.png': 'bb'.repeat(32) } },
    })

    expect(changes).toEqual([
      { field: 'streamUri', before: null, after: 'https://video.example/v' },
      {
        field: 'headerContent',
        mediaUrl: 'https://media.example/header.png',
        before: 'aa'.repeat(32),
        after: 'bb'.repeat(32),
      },
    ])
  })

  it('reports a header image whose content hash changed under the same URL', () => {
    const changes = diffMetadata(baseMetadata, {
      ...baseMetadata,
      meta: { mediaHashes: { 'https://media.example/header.png': 'cc'.repeat(32) } },
    })

    expect(changes).toEqual([
      {
        field: 'headerContent',
        mediaUrl: 'https://media.example/header.png',
        before: 'aa'.repeat(32),
        after: 'cc'.repeat(32),
      },
    ])
  })

  it('reports the hash of other media files apart from the header image', () => {
    const extra = 'https://media.example/logo.png'
    const changes = diffMetadata(
      { ...baseMetadata, meta: { mediaHashes: { ...baseMetadata.meta.mediaHashes, [extra]: 'dd'.repeat(32) } } },
      { ...baseMetadata, meta: { mediaHashes: { ...baseMetadata.meta.mediaHashes, [extra]: 'ee'.repeat(32) } } }
    )

    expect(changes).toEqual([{ field: 'mediaHash', mediaUrl: extra, before: 'dd'.repeat(32), after: 'ee'.repeat(32) }])
  })

  it('reports question and choice text changes, including added choices', () => {
    const [question] = baseMetadata.questions
    const changes = diffMetadata(baseMetadata, {
      ...baseMetadata,
      questions: [
        {
          ...question,
          title: { default: 'Who should chair the board next year?' },
          choices: [
            { title: { default: 'Alicia' }, value: 0 },
            { title: { default: 'Bob' }, value: 1 },
            { title: { default: 'Carol' }, value: 2 },
          ],
        },
      ],
    })

    expect(changes).toEqual([
      {
        field: 'questionTitle',
        question: 0,
        lang: 'default',
        before: 'Who should chair the board?',
        after: 'Who should chair the board next year?',
      },
      { field: 'choiceTitle', question: 0, choice: 0, lang: 'default', before: 'Alice', after: 'Alicia' },
      { field: 'choiceTitle', question: 0, choice: 2, lang: 'default', before: null, after: 'Carol' },
      // The added choice also brings a new value, which is not one of the audited text fields.
      { field: 'other', before: null, after: null },
    ])
  })

  it('reports a change of the question elections a parent election lists', () => {
    const parent = (questionElections: string[]) => ({
      ...baseMetadata,
      questions: [],
      meta: { ...baseMetadata.meta, questionElections },
    })

    expect(diffMetadata(parent(['0xAB01', 'ab02']), parent(['ab01', 'ab02']))).toEqual([])
    expect(diffMetadata(parent(['ab01', 'ab02']), parent(['ab02', 'ab01']))).toEqual([
      { field: 'questionElections', before: 'ab01\nab02', after: 'ab02\nab01' },
    ])
    expect(
      diffMetadata(baseMetadata, { ...baseMetadata, meta: { ...baseMetadata.meta, questionElections: ['ab01'] } })
    ).toEqual([{ field: 'questionElections', before: null, after: 'ab01' }])
  })

  describe('choice description and images', () => {
    const alicePhoto = 'https://media.example/alice.png'
    const aliceThumb = 'https://media.example/alice-thumb.png'
    const withChoices = (aliceMeta: Record<string, unknown>, mediaHashes: Record<string, string> = {}) => ({
      ...baseMetadata,
      meta: { mediaHashes },
      questions: [
        {
          ...baseMetadata.questions[0],
          choices: [
            { title: { default: 'Alice' }, value: 0, meta: aliceMeta },
            { title: { default: 'Bob' }, value: 1 },
          ],
        },
      ],
    })

    it('reports the description, the image URLs and the image content hash per choice', () => {
      const changes = diffMetadata(
        withChoices({ description: 'Lawyer from Lleida.', image: alicePhoto }, { [alicePhoto]: 'aa'.repeat(32) }),
        withChoices(
          { description: 'Lawyer from Girona.', image: { default: alicePhoto, thumbnail: aliceThumb } },
          { [alicePhoto]: 'bb'.repeat(32), [aliceThumb]: 'cc'.repeat(32) }
        )
      )

      expect(changes).toEqual([
        {
          field: 'choiceImageContent',
          question: 0,
          choice: 0,
          mediaUrl: aliceThumb,
          before: null,
          after: 'cc'.repeat(32),
        },
        {
          field: 'choiceImageContent',
          question: 0,
          choice: 0,
          mediaUrl: alicePhoto,
          before: 'aa'.repeat(32),
          after: 'bb'.repeat(32),
        },
        {
          field: 'choiceDescription',
          question: 0,
          choice: 0,
          lang: 'default',
          before: 'Lawyer from Lleida.',
          after: 'Lawyer from Girona.',
        },
        { field: 'choiceImage', question: 0, choice: 0, variant: 'thumbnail', before: null, after: aliceThumb },
      ])
    })

    it('reports a choice image whose content changed under the same URL', () => {
      expect(
        diffMetadata(
          withChoices({ image: alicePhoto }, { [alicePhoto]: 'aa'.repeat(32) }),
          withChoices({ image: alicePhoto }, { [alicePhoto]: 'dd'.repeat(32) })
        )
      ).toEqual([
        {
          field: 'choiceImageContent',
          question: 0,
          choice: 0,
          mediaUrl: alicePhoto,
          before: 'aa'.repeat(32),
          after: 'dd'.repeat(32),
        },
      ])
    })

    it('treats an empty choice meta as absent and other choice meta keys as other settings', () => {
      expect(diffMetadata(withChoices({}), { ...withChoices({}), questions: baseMetadata.questions })).toEqual([])
      expect(diffMetadata(withChoices({ party: 'A' }), withChoices({ party: 'B' }))).toEqual([
        { field: 'other', before: null, after: null },
      ])
    })

    it('reports question meta changes as other settings', () => {
      const withQuestionMeta = (meta: Record<string, unknown>) => ({
        ...baseMetadata,
        questions: [{ ...baseMetadata.questions[0], meta }],
      })

      expect(diffMetadata(withQuestionMeta({ layout: 'grid' }), withQuestionMeta({ layout: 'list' }))).toEqual([
        { field: 'other', before: null, after: null },
      ])
    })
  })

  it('reports any other difference once', () => {
    expect(diffMetadata(baseMetadata, { ...baseMetadata, type: { name: 'approval', properties: {} } })).toEqual([
      { field: 'other', before: null, after: null },
    ])
  })
})

describe('diffWords', () => {
  it('marks the words that changed and keeps the rest', () => {
    expect(diffWords('Vote for the new board', 'Vote for the next board')).toEqual([
      { type: 'same', text: 'Vote for the ' },
      { type: 'removed', text: 'new' },
      { type: 'added', text: 'next' },
      { type: 'same', text: ' board' },
    ])
  })

  it('rebuilds both texts from its segments', () => {
    const before = 'The  quorum is 50%.\nVoting closes at noon.'
    const after = 'The quorum is 60%.\nVoting closes at 18:00.'
    const segments = diffWords(before, after)

    expect(
      segments
        .filter((segment) => segment.type !== 'added')
        .map((segment) => segment.text)
        .join('')
    ).toBe(before)
    expect(
      segments
        .filter((segment) => segment.type !== 'removed')
        .map((segment) => segment.text)
        .join('')
    ).toBe(after)
  })

  it('handles empty texts', () => {
    expect(diffWords('', 'Added')).toEqual([{ type: 'added', text: 'Added' }])
    expect(diffWords('Removed', '')).toEqual([{ type: 'removed', text: 'Removed' }])
  })
})

describe('condenseDiff', () => {
  it('keeps only the words around a change in long unchanged runs', () => {
    const words = Array.from({ length: 30 }, (_, index) => `w${index}`)
    const before = `${words.join(' ')} typo ${words.join(' ')}`
    const after = `${words.join(' ')} fixed ${words.join(' ')}`
    const condensed = condenseDiff(diffWords(before, after), 2)

    expect(condensed).toEqual([
      { type: 'same', text: '… w28 w29 ' },
      { type: 'removed', text: 'typo' },
      { type: 'added', text: 'fixed' },
      { type: 'same', text: ' w0 w1 … ' },
    ])
  })

  it('leaves short runs untouched', () => {
    const segments = diffWords('a b c', 'a x c')
    expect(condenseDiff(segments, 2)).toEqual(segments)
  })
})
