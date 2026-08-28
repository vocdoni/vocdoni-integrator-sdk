import { describe, it, expect } from 'vitest'
import { inferBallotType, inferQuestionBallotType } from './infer'
import { BallotType } from './types'
import type { Election } from '@vocdoni/api-types'

describe('inferBallotType', () => {
  const createElection = (voteType: Partial<Election['voteType']>, questions: number = 1): Pick<Election, 'questions' | 'voteType'> => ({
    voteType: {
      maxCount: 1,
      maxValue: 0,
      maxVoteOverwrites: 0,
      costExponent: 0,
      uniqueChoices: false,
      costFromWeight: false,
      ...voteType,
    },
    questions: Array.from({ length: questions }, (_, i) => ({
      title: { default: `Question ${i}` },
      choices: Array.from({ length: 3 }, (_, j) => ({
        title: { default: `Choice ${j}` },
        value: j,
      })),
    })),
  })

  describe('Budget vs Quadratic (maxValue === 0)', () => {
    it('infers budget when costExponent === 1', () => {
      const election = createElection({ maxValue: 0, costExponent: 1 })
      expect(inferBallotType(election)).toBe(BallotType.Budget)
    })

    it('infers quadratic when costExponent === 2', () => {
      const election = createElection({ maxValue: 0, costExponent: 2 })
      expect(inferBallotType(election)).toBe(BallotType.Quadratic)
    })

    it('defaults to budget when costExponent is not 2 and maxValue === 0', () => {
      const election = createElection({ maxValue: 0, costExponent: 0 })
      expect(inferBallotType(election)).toBe(BallotType.Budget)
    })
  })

  describe('Multi-question elections', () => {
    it('infers single-choice for multi-question elections', () => {
      const election = createElection({}, 3)
      expect(inferBallotType(election)).toBe(BallotType.SingleChoice)
    })

    it('ignores voteType when questions.length > 1', () => {
      const election = createElection({ maxValue: 0, costExponent: 2 }, 5)
      expect(inferBallotType(election)).toBe(BallotType.SingleChoice)
    })
  })

  describe('Single-question elections', () => {
    describe('Single-choice (maxCount === 1)', () => {
      it('infers single-choice when maxCount === 1 and maxValue > 0', () => {
        const election = createElection({ maxCount: 1, maxValue: 2 })
        expect(inferBallotType(election)).toBe(BallotType.SingleChoice)
      })

      it('infers single-choice even with uniqueChoices === false', () => {
        const election = createElection({ maxCount: 1, maxValue: 1, uniqueChoices: false })
        expect(inferBallotType(election)).toBe(BallotType.SingleChoice)
      })
    })

    describe('Approval (maxValue === 1, uniqueChoices false)', () => {
      it('infers approval when maxValue === 1 and uniqueChoices === false', () => {
        const election = createElection({ maxCount: 2, maxValue: 1, uniqueChoices: false })
        expect(inferBallotType(election)).toBe(BallotType.Approval)
      })
    })

    describe('Multichoice (default)', () => {
      it('infers multichoice when maxCount > 1 and maxValue > 1', () => {
        const election = createElection({ maxCount: 3, maxValue: 4 })
        expect(inferBallotType(election)).toBe(BallotType.MultiChoice)
      })

      it('infers multichoice for pick-slot shapes regardless of uniqueChoices', () => {
        const election = createElection({ maxCount: 2, maxValue: 4, uniqueChoices: true })
        expect(inferBallotType(election)).toBe(BallotType.MultiChoice)
      })

      it('infers multichoice for a 2-option index-list (maxValue === 1, uniqueChoices true)', () => {
        // maxValue === 1 with uniqueChoices is a 2-option index-list (the only satisfiable
        // such shape is maxCount === 2 — pigeonhole); uniqueChoices is what separates it
        // from dense approval, which is always uniqueChoices: false.
        const election = createElection({ maxCount: 2, maxValue: 1, uniqueChoices: true })
        expect(inferBallotType(election)).toBe(BallotType.MultiChoice)
      })
    })
  })

  describe('Declared type name (legacy vochain metadata.type.name)', () => {
    // The shapes the legacy @vocdoni/sdk generates for a 2-option election, read off
    // 0.9.3's dist:
    //   ApprovalElection.generateVoteOptions   → maxCount = numChoices, maxValue = 1
    //   ApprovalElection.generateEnvelopeType  → uniqueValues = false
    //   MultiChoiceElection.generateVoteOptions→ maxCount = maxNumberOfChoices,
    //                                            maxValue = numChoices - 1 + abstain
    //   MultiChoiceElection.generateEnvelopeType → uniqueValues = !canRepeatChoices
    // With 2 choices, canRepeatChoices: true and no abstain allowance, multichoice lands
    // on {maxCount: 2, maxValue: 1, uniqueChoices: false} — byte-identical to the
    // 2-option approval shape. #24's uniqueChoices discriminator cannot reach this pair;
    // only the declared name separates them.
    const ambiguous = { maxCount: 2, maxValue: 1, uniqueChoices: false }

    it('separates the 2-option approval / repeatable-multichoice collision', () => {
      expect(inferBallotType({ ...createElection(ambiguous), type: 'multiple-choice' })).toBe(
        BallotType.MultiChoice
      )
      expect(inferBallotType({ ...createElection(ambiguous), type: 'approval' })).toBe(
        BallotType.Approval
      )
    })

    it('falls back to shape when no name is present', () => {
      // Unchanged behaviour: shape alone still reads this as approval.
      expect(inferBallotType(createElection(ambiguous))).toBe(BallotType.Approval)
    })

    it('wins over a shape that would decide otherwise', () => {
      // A recognized name short-circuits the whole tree. Real producers emit name and
      // shape together, so these pairings are synthetic — they pin the precedence.
      const cases: Array<[string, Record<string, number | boolean>, BallotType]> = [
        ['approval', { maxCount: 2, maxValue: 3 }, BallotType.Approval],
        ['multiple-choice', { maxCount: 1, maxValue: 1 }, BallotType.MultiChoice],
        ['budget-based', { maxCount: 3, maxValue: 2 }, BallotType.Budget],
        ['quadratic', { maxCount: 3, maxValue: 2 }, BallotType.Quadratic],
        ['single-choice-multiquestion', { maxCount: 3, maxValue: 2 }, BallotType.SingleChoice],
      ]
      for (const [type, voteType, expected] of cases) {
        expect(inferBallotType({ ...createElection(voteType), type })).toBe(expected)
      }
    })

    it('reads the name out of the legacy metadata bag', () => {
      expect(
        inferBallotType({ ...createElection(ambiguous), meta: { type: { name: 'multiple-choice' } } })
      ).toBe(BallotType.MultiChoice)
      expect(
        inferBallotType({ ...createElection(ambiguous), meta: { type: { name: 'approval' } } })
      ).toBe(BallotType.Approval)
    })

    it('prefers the explicit type field over the legacy bag', () => {
      // So a caller can override a stale metadata name without editing the bag.
      expect(
        inferBallotType({
          ...createElection(ambiguous),
          type: 'approval',
          meta: { type: { name: 'multiple-choice' } },
        })
      ).toBe(BallotType.Approval)
    })

    it('survives a malformed metadata bag', () => {
      // The bag is Record<string, unknown> and creator-controlled — every level must be
      // probed defensively rather than trusted into a throw.
      const shaped = createElection({ maxCount: 3, maxValue: 4 })
      for (const meta of [
        {},
        { type: 'multiple-choice' },
        { type: null },
        { type: { name: 42 } },
        { type: { name: 'nonsense' } },
      ] as Array<Record<string, unknown>>) {
        expect(inferBallotType({ ...shaped, meta })).toBe(BallotType.MultiChoice)
      }
    })

    it('ignores an unrecognized, empty or absent name', () => {
      // An unknown spelling must not hijack the tree, and an empty string is the stored
      // form for raw-protocol questions, so it must read as "no name". (`ranked` used to
      // be the example here; it is a recognized SDK name since #22 — see ranked.test.ts.)
      const shaped = createElection({ maxCount: 3, maxValue: 4 })
      expect(inferBallotType({ ...shaped, type: 'condorcet' })).toBe(BallotType.MultiChoice)
      expect(inferBallotType({ ...shaped, type: '' })).toBe(BallotType.MultiChoice)
      expect(inferBallotType({ ...shaped, type: undefined })).toBe(BallotType.MultiChoice)
    })
  })

  describe('Edge cases', () => {
    it('handles empty questions array (should not happen in practice)', () => {
      const election = {
        voteType: {
          maxCount: 1,
          maxValue: 0,
          maxVoteOverwrites: 0,
          costExponent: 0,
          uniqueChoices: false,
          costFromWeight: false,
        },
        questions: [],
      } as Pick<Election, 'questions' | 'voteType'>
      
      // With no questions, it defaults to budget (maxValue === 0)
      expect(inferBallotType(election)).toBe(BallotType.Budget)
    })

    it('respects precedence: maxValue === 0 before single-choice check', () => {
      const election = createElection({ maxValue: 0, costExponent: 1, maxCount: 1 })
      expect(inferBallotType(election)).toBe(BallotType.Budget)
    })
  })
})

describe('inferQuestionBallotType', () => {
  const bp = (overrides: Record<string, number | boolean> = {}) => ({
    maxCount: 1,
    maxValue: 1,
    maxVoteOverwrites: 0,
    maxTotalCost: 0,
    costExponent: 1,
    uniqueValues: false,
    costFromWeight: false,
    ...overrides,
  })

  it('infers from ballotProtocol when no recognized name is present', () => {
    expect(inferQuestionBallotType({ ballotProtocol: bp() })).toBe(BallotType.SingleChoice)
    expect(inferQuestionBallotType({ ballotProtocol: bp({ maxCount: 2, maxValue: 3 }) })).toBe(
      BallotType.MultiChoice
    )
  })

  it('lets a recognized named type win over a conflicting protocol', () => {
    // Declared intent first, shape as fallback. The backend derives the dense layout from
    // the named type, so a `multichoice` question is dense whatever maxCount says — and
    // decodeQuestionResults remaps MultiChoice+dense to the `results[i][1]` read. The old
    // SingleChoice label read results[0][choiceValue] instead, off the wrong axis.
    expect(inferQuestionBallotType({ ballotProtocol: bp(), type: 'multichoice' })).toBe(
      BallotType.MultiChoice
    )
    expect(
      inferQuestionBallotType({ ballotProtocol: bp({ maxCount: 3, maxValue: 4 }), type: 'singlechoice' })
    ).toBe(BallotType.SingleChoice)
  })

  it('reads the legacy vocabulary from the question metadata bag', () => {
    // In the SaaS model each question is its own vochain process, so a question mapped
    // from a legacy election carries that election's metadata.type. The bag takes the
    // legacy vocabulary; the `type` field takes the SaaS one.
    expect(
      inferQuestionBallotType({
        ballotProtocol: bp({ maxCount: 2, maxValue: 1, uniqueValues: false }),
        metadata: { type: { name: 'multiple-choice' } },
      })
    ).toBe(BallotType.MultiChoice)
    // The SaaS field still wins when both are present.
    expect(
      inferQuestionBallotType({
        ballotProtocol: bp({ maxCount: 2, maxValue: 1 }),
        type: 'singlechoice',
        metadata: { type: { name: 'multiple-choice' } },
      })
    ).toBe(BallotType.SingleChoice)
    // And the legacy spelling is not honoured on the SaaS field, nor vice versa.
    expect(
      inferQuestionBallotType({ ballotProtocol: bp(), metadata: { type: { name: 'multichoice' } } })
    ).toBe(BallotType.SingleChoice)
  })

  it('falls back to the protocol for a name outside the SaaS vocabulary', () => {
    // Only `singlechoice` / `multichoice` are stored here (VOTING_PROCESS_QUESTION_TYPES);
    // the legacy vochain spellings mean a different wire layout and must not be honoured
    // on this path. Unrecognized → shape, and the throw stays confined to "no protocol
    // *and* no recognized name".
    expect(inferQuestionBallotType({ ballotProtocol: bp(), type: 'approval' })).toBe(
      BallotType.SingleChoice
    )
    expect(inferQuestionBallotType({ ballotProtocol: bp(), type: 'multiple-choice' })).toBe(
      BallotType.SingleChoice
    )
    expect(inferQuestionBallotType({ ballotProtocol: bp(), type: '' })).toBe(
      BallotType.SingleChoice
    )
  })

  describe('dense protocols (maxValue === 1, maxCount > 1, uniqueValues false)', () => {
    // The backend derives this shape for the named multichoice type: one 0/1 field per
    // choice, maxTotalCost bounding the picks. The named type keeps its semantic MultiChoice
    // label; anything else is approval. uniqueValues must be false here — dense + uniqueValues
    // is the unsatisfiable pigeonhole shape rejected at creation, and at maxValue === 1 a
    // uniqueValues protocol is instead a 2-option index-list (see the next describe).
    const dense = () => bp({ maxCount: 3, maxValue: 1, maxTotalCost: 2, uniqueValues: false })

    it('keeps the MultiChoice label for named multichoice questions', () => {
      expect(
        inferQuestionBallotType({ ballotProtocol: dense(), type: 'multichoice' })
      ).toBe(BallotType.MultiChoice)
    })

    it('infers approval for dense protocols without the multichoice type', () => {
      expect(inferQuestionBallotType({ ballotProtocol: dense() })).toBe(BallotType.Approval)
    })
  })

  describe('2-option index-list (maxValue === 1, uniqueValues true)', () => {
    // The only satisfiable maxValue === 1 && uniqueValues shape is maxCount === 2
    // (pigeonhole): two pick-slots holding values 0 and 1. It is an index-list multichoice
    // (wire-identical to a 2-option ranked ballot), so it takes the MultiChoice label even
    // with no named type — the backend empties the type label for shapes it cannot name.
    const twoOpt = () => bp({ maxCount: 2, maxValue: 1, uniqueValues: true })

    it('infers multichoice with or without the named type', () => {
      expect(inferQuestionBallotType({ ballotProtocol: twoOpt() })).toBe(BallotType.MultiChoice)
      expect(
        inferQuestionBallotType({ ballotProtocol: twoOpt(), type: 'multichoice' })
      ).toBe(BallotType.MultiChoice)
    })
  })

  it('falls back to the named type when ballotProtocol is missing', () => {
    expect(inferQuestionBallotType({ type: 'singlechoice' })).toBe(BallotType.SingleChoice)
    expect(inferQuestionBallotType({ type: 'multichoice' })).toBe(BallotType.MultiChoice)
  })

  it('throws when neither ballotProtocol nor a supported type is present', () => {
    expect(() => inferQuestionBallotType({})).toThrow(/cannot infer ballot type/)
    expect(() => inferQuestionBallotType({ type: 'singleChoice' })).toThrow(/cannot infer/)
    expect(() => inferQuestionBallotType({ type: 'approval' })).toThrow(/cannot infer/)
  })
})
