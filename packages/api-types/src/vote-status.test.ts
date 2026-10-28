import { describe, expectTypeOf, it } from 'vitest'
import type {
  ProcessParticipantQuestionVote,
  ProcessQuestionStatus,
  VerifiedVote,
  VerifyVotesRequest,
  VerifyVotesResponse,
} from './index'

describe('vote status types', () => {
  it('carries hasSigned as optional on both voter-status shapes', () => {
    expectTypeOf<ProcessQuestionStatus['hasSigned']>().toEqualTypeOf<boolean | undefined>()
    expectTypeOf<ProcessParticipantQuestionVote['hasSigned']>().toEqualTypeOf<boolean | undefined>()
  })

  it('types POST /votes/verify as in the backend swagger', () => {
    expectTypeOf<VerifyVotesRequest>().toEqualTypeOf<{ nullifiers: string[] }>()
    expectTypeOf<VerifyVotesResponse['votes']>().toEqualTypeOf<VerifiedVote[]>()
    expectTypeOf<VerifiedVote>().toEqualTypeOf<{
      nullifier: string
      verified: boolean
      processId?: string
      blockHeight?: number
      date?: string
      txHash?: string
    }>()
  })
})
