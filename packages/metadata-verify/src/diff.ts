/**
 * Field-level differences between two versions of an election metadata document, and a
 * word-level diff of two texts, so a reader can tell a typo fix from a change of meaning.
 */
import {
  asArray,
  asRecord,
  imageVariants,
  isRecord,
  readMediaHashes,
  readQuestionElections,
  toLanguageMap,
} from './common'

export type MetadataChangeField =
  | 'title'
  | 'description'
  | 'header'
  | 'streamUri'
  /** The hash of a medium that is neither the header nor a choice image. */
  | 'mediaHash'
  /** The header image's content hash. */
  | 'headerContent'
  | 'questionElections'
  | 'questionTitle'
  | 'questionDescription'
  | 'choiceTitle'
  | 'choiceDescription'
  /** A choice image URL, per `variant`. */
  | 'choiceImage'
  /** A choice image's content hash. */
  | 'choiceImageContent'
  /** Anything else in the document; reported once, without values. */
  | 'other'

/**
 * One field that differs between two consecutive versions. `before`/`after` are null when the field
 * is absent on that side (e.g. a choice that was added). Indexes are zero-based.
 */
export interface MetadataChange {
  field: MetadataChangeField
  lang?: string
  question?: number
  choice?: number
  mediaUrl?: string
  /** Which image of a choice: `default`, `thumbnail` or any other key the document uses. */
  variant?: string
  before: string | null
  after: string | null
}

export interface DiffSegment {
  type: 'same' | 'removed' | 'added'
  text: string
}

/** `default` first, then alphabetical. */
const compareKeys = (a: string, b: string) => {
  if (a === b) return 0
  if (a === 'default') return -1
  if (b === 'default') return 1
  return a.localeCompare(b)
}

const unionKeys = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(compareKeys)

const diffText = (
  before: unknown,
  after: unknown,
  base: Omit<MetadataChange, 'lang' | 'before' | 'after'>
): MetadataChange[] => {
  const beforeMap = toLanguageMap(before)
  const afterMap = toLanguageMap(after)
  return unionKeys(beforeMap, afterMap)
    .filter((lang) => beforeMap[lang] !== afterMap[lang])
    .map((lang) => ({ ...base, lang, before: beforeMap[lang] ?? null, after: afterMap[lang] ?? null }))
}

const diffString = (
  before: unknown,
  after: unknown,
  base: Omit<MetadataChange, 'before' | 'after'>
): MetadataChange[] => {
  const beforeValue = typeof before === 'string' && before ? before : null
  const afterValue = typeof after === 'string' && after ? after : null
  return beforeValue === afterValue ? [] : [{ ...base, before: beforeValue, after: afterValue }]
}

/** JSON with object keys sorted, so two documents differing only in key order compare equal. */
const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

const omit = (value: unknown, keys: string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(asRecord(value)).filter(([key]) => !keys.includes(key)))

const choiceImages = (choice: unknown) => imageVariants(asRecord(asRecord(choice).meta).image)

/** A choice without its audited fields; its `meta` is kept only when something else is left in it. */
const withoutAuditedChoiceFields = (choice: Record<string, unknown>) => {
  const otherMeta = omit(choice.meta, ['description', 'image'])
  return { ...omit(choice, ['title', 'meta']), ...(Object.keys(otherMeta).length ? { meta: otherMeta } : {}) }
}

/** The document without the fields diffed one by one, to detect any change in the rest of it. */
const withoutAuditedFields = (doc: Record<string, unknown>): unknown => ({
  ...omit(doc, ['title', 'description', 'media', 'meta', 'questions']),
  media: omit(doc.media, ['header', 'streamUri']),
  meta: omit(doc.meta, ['mediaHashes', 'questionElections']),
  questions: asArray(doc.questions).map((question) =>
    isRecord(question)
      ? {
          ...omit(question, ['title', 'description', 'choices']),
          choices: asArray(question.choices).map((choice) =>
            isRecord(choice) ? withoutAuditedChoiceFields(choice) : choice
          ),
        }
      : question
  ),
})

/**
 * Field-level differences between two election metadata documents: multi-language title and
 * description, header image and video URLs, media content hashes (header, choice images, any
 * other), the question elections a parent election lists, the title and description of every
 * question, and the title, description and image URLs of every choice. Anything else that
 * differs is reported as a single `other` change, so no difference goes unreported.
 */
export const diffMetadata = (beforeDoc: unknown, afterDoc: unknown): MetadataChange[] => {
  const before = asRecord(beforeDoc)
  const after = asRecord(afterDoc)
  const beforeMedia = asRecord(before.media)
  const afterMedia = asRecord(after.media)
  const changes: MetadataChange[] = [
    ...diffText(before.title, after.title, { field: 'title' }),
    ...diffText(before.description, after.description, { field: 'description' }),
    ...diffString(beforeMedia.header, afterMedia.header, { field: 'header' }),
    ...diffString(beforeMedia.streamUri, afterMedia.streamUri, { field: 'streamUri' }),
  ]

  // Choice images are hashed in the same document as their choice, so each hash entry is attributed
  // to the choice whose image URL it covers, in either version.
  const choiceImageOwners = new Map<string, { question: number; choice: number }>()
  for (const doc of [before, after]) {
    asArray(doc.questions).forEach((question, questionIndex) =>
      asArray(asRecord(question).choices).forEach((choice, choiceIndex) => {
        for (const url of Object.values(choiceImages(choice))) {
          choiceImageOwners.set(url, { question: questionIndex, choice: choiceIndex })
        }
      })
    )
  }

  const beforeHashes = readMediaHashes(before)
  const afterHashes = readMediaHashes(after)
  for (const url of [...new Set([...Object.keys(beforeHashes), ...Object.keys(afterHashes)])].sort()) {
    const beforeHash = beforeHashes[url] ?? null
    const afterHash = afterHashes[url] ?? null
    if (beforeHash === afterHash) continue
    // Images are covered by the hash of their content, so an image whose hash changed shows
    // different content even when its URL stayed the same.
    const isHeader = url === beforeMedia.header || url === afterMedia.header
    const choiceOwner = isHeader ? undefined : choiceImageOwners.get(url)
    changes.push({
      field: isHeader ? 'headerContent' : choiceOwner ? 'choiceImageContent' : 'mediaHash',
      ...choiceOwner,
      mediaUrl: url,
      before: beforeHash,
      after: afterHash,
    })
  }

  // A parent election lists its question elections; the list is fixed at publish time, so any
  // change to it is notable and reported on its own.
  const beforeElections = readQuestionElections(before)
  const afterElections = readQuestionElections(after)
  if ((beforeElections ?? []).join('\n') !== (afterElections ?? []).join('\n')) {
    changes.push({
      field: 'questionElections',
      before: beforeElections?.length ? beforeElections.join('\n') : null,
      after: afterElections?.length ? afterElections.join('\n') : null,
    })
  }

  const beforeQuestions = asArray(before.questions)
  const afterQuestions = asArray(after.questions)
  for (let question = 0; question < Math.max(beforeQuestions.length, afterQuestions.length); question++) {
    const beforeQuestion = asRecord(beforeQuestions[question])
    const afterQuestion = asRecord(afterQuestions[question])
    changes.push(
      ...diffText(beforeQuestion.title, afterQuestion.title, { field: 'questionTitle', question }),
      ...diffText(beforeQuestion.description, afterQuestion.description, { field: 'questionDescription', question })
    )

    const beforeChoices = asArray(beforeQuestion.choices)
    const afterChoices = asArray(afterQuestion.choices)
    for (let choice = 0; choice < Math.max(beforeChoices.length, afterChoices.length); choice++) {
      const beforeChoice = asRecord(beforeChoices[choice])
      const afterChoice = asRecord(afterChoices[choice])
      changes.push(
        ...diffText(beforeChoice.title, afterChoice.title, { field: 'choiceTitle', question, choice }),
        ...diffText(asRecord(beforeChoice.meta).description, asRecord(afterChoice.meta).description, {
          field: 'choiceDescription',
          question,
          choice,
        })
      )
      const beforeImages = choiceImages(beforeChoice)
      const afterImages = choiceImages(afterChoice)
      for (const variant of unionKeys(beforeImages, afterImages)) {
        changes.push(
          ...diffString(beforeImages[variant], afterImages[variant], { field: 'choiceImage', question, choice, variant })
        )
      }
    }
  }

  if (stableStringify(withoutAuditedFields(before)) !== stableStringify(withoutAuditedFields(after))) {
    changes.push({ field: 'other', before: null, after: null })
  }

  return changes
}

// Above this many LCS cells the texts are shown as fully replaced rather than diffed word by word,
// to keep the work bounded on very long descriptions.
const MAX_DIFF_CELLS = 4_000_000

/** Words and whitespace runs as separate tokens, so joining them rebuilds the text exactly. */
const tokenize = (text: string) => text.match(/\s+|\S+/g) ?? []

/** Words with the whitespace around them, for counting context words; joining rebuilds the text. */
const splitWords = (text: string) => text.match(/\s*\S+\s*|\s+/g) ?? []

const pushSegment = (segments: DiffSegment[], type: DiffSegment['type'], text: string) => {
  const last = segments[segments.length - 1]
  if (last?.type === type) last.text += text
  else if (text) segments.push({ type, text })
}

/** Word-level diff of two texts as runs of unchanged, removed and added text. */
export const diffWords = (before: string, after: string): DiffSegment[] => {
  const a = tokenize(before)
  const b = tokenize(after)
  const segments: DiffSegment[] = []

  if (a.length * b.length > MAX_DIFF_CELLS) {
    pushSegment(segments, 'removed', before)
    pushSegment(segments, 'added', after)
    return segments
  }

  // lengths[i][j] = LCS length of a[i..] and b[j..]
  const lengths = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }

  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pushSegment(segments, 'same', a[i])
      i++
      j++
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      pushSegment(segments, 'removed', a[i++])
    } else {
      pushSegment(segments, 'added', b[j++])
    }
  }
  while (i < a.length) pushSegment(segments, 'removed', a[i++])
  while (j < b.length) pushSegment(segments, 'added', b[j++])

  return segments
}

/**
 * Shortens long unchanged runs to the words next to a change, so a one-word fix in a long
 * description reads as that fix in its context instead of the whole description twice.
 */
export const condenseDiff = (segments: DiffSegment[], contextWords = 8, ellipsis = '… '): DiffSegment[] =>
  segments.map((segment, index) => {
    if (segment.type !== 'same') return segment
    const words = splitWords(segment.text)
    const hasChangeBefore = index > 0
    const hasChangeAfter = index < segments.length - 1
    const keep = (hasChangeBefore ? contextWords : 0) + (hasChangeAfter ? contextWords : 0)
    if (words.length <= keep + 1) return segment

    const head = hasChangeBefore ? words.slice(0, contextWords).join('') : ''
    const tail = hasChangeAfter ? words.slice(words.length - contextWords).join('') : ''
    return { type: 'same', text: `${head}${ellipsis}${tail}` }
  })
