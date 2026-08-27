import { encodeQuestionSelections, hasUncastableChoices } from '@vocdoni/ballot'
import { createContext, PropsWithChildren, useContext, useEffect } from 'react'
import { FieldValues, FormProvider, useForm, UseFormReturn } from 'react-hook-form'
import { EnsureConfirmProvider } from '../../../confirm/ConfirmProvider'
import { useConfirm } from '../../../confirm/useConfirm'
import { useReactComponentsLocalize } from '../../../i18n/localize'
import { useElection } from '@vocdoni/react-providers'
import { QuestionsConfirmation } from './Confirmation'

export type QuestionsFormContextState = {
  fmethods: UseFormReturn<any>
  vote: (values: FieldValues) => Promise<string | false | void>
}

const QuestionsFormContext = createContext<QuestionsFormContextState | undefined>(undefined)

export const useQuestionsForm = () => {
  const context = useContext(QuestionsFormContext)
  if (!context) {
    throw new Error('useQuestionsForm must be used within a QuestionsFormProvider')
  }
  return context
}

export type QuestionsFormProviderProps = {}

// Mounts its own ConfirmProvider when the app doesn't provide one, so the
// vote-confirmation dialog works out of the box.
export const QuestionsFormProvider = (props: PropsWithChildren<QuestionsFormProviderProps>) => (
  <EnsureConfirmProvider>
    <QuestionsFormProviderInner {...props} />
  </EnsureConfirmProvider>
)

const QuestionsFormProviderInner = ({ children }: PropsWithChildren<QuestionsFormProviderProps>) => {
  const fmethods = useForm()
  const { confirm } = useConfirm()
  const { election, vote: baseVote } = useElection()
  const t = useReactComponentsLocalize()

  const vote = async (values: FieldValues) => {
    if (!election) {
      console.warn('vote attempt with no valid election defined')
      return false
    }

    if (!(await confirm(<QuestionsConfirmation election={election} answers={values} />))) {
      return false
    }

    // Build per-question raw selections from the form values.
    //
    // NaN entries are dropped rather than forwarded: a ranked question's array is the
    // voter's ordering padded with '' for the places nobody filled, and `parseInt('')`
    // is NaN. Validation blocks that submit, but `vote` is also exported on the form
    // context for callers driving it themselves — and forwarded, NaN reaches
    // `rankedOrderToScores` as "NaN is not a choice value of this question" instead of
    // the accurate "every option must be ranked (2 of 3 ranked, missing 1)". Every other
    // type's entries are choice-value strings, so the filter is a no-op there.
    const selections = election.questions.map((_q, index) => {
      const raw = values[index.toString()]
      if (Array.isArray(raw)) {
        return raw.map((value) => parseInt(value, 10)).filter((value) => Number.isFinite(value))
      }
      if (raw === undefined || raw === '') return []
      return [parseInt(raw, 10)]
    })

    // Encode each question's ballot using its own ballot protocol. Encoding throws
    // rather than produce a ballot the chain would accept and silently drop at tally
    // (unsatisfiable config, out-of-range value, repeated unique pick) — mark the
    // offending question invalid and abort, instead of letting the rejection escape
    // handleSubmit as an unhandled promise on a vote that was never going to count.
    const encodedBallots: number[][] = []
    for (const [index, question] of election.questions.entries()) {
      try {
        // `encodeQuestionSelections`, not `encodeQuestionBallot`: a ranked question's
        // form value is the voter's ORDERING (choice values, best first — see
        // RankedChoice) while the wire wants one rank per option in choice order. The
        // transposition and its highest-is-best orientation live inside the ballot
        // package, so this form does not carry a per-type branch that, written the
        // wrong way round, would produce a valid ballot electing the loser.
        encodedBallots.push(encodeQuestionSelections(question, selections[index] ?? []))
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        // Two very different failures land here and only one of them is the voter's to
        // act on. "Too many selections" they can fix. A question that published an
        // option nobody can record is a defect in the election, fixable only before
        // publish, and the encoder explains it in the creator's terms — maxValue,
        // voteCount, the scrutinizer. Rendering that verbatim in a ballot field asks
        // someone to act on something they have no power over, on a form that offered
        // them the option in the first place. Keep the detail for whoever is debugging.
        const unvotable = hasUncastableChoices(question)
        if (unvotable) {
          console.error(`question ${index} publishes a choice no voter can cast: ${detail}`)
        }
        fmethods.setError(index.toString(), {
          type: 'encode',
          message: unvotable ? t('errors.question_not_votable') : detail,
        })
        return false
      }
    }

    // Reserved `memo.{index}` form fields become per-question vote memos
    // (free-text notes, e.g. an open "Other" answer) — register one as
    // `memo.0`, `memo.1`, … in the form slot to collect them. ⚠️ Memos ride
    // the vote envelope in cleartext, even on secret elections.
    const memos = election.questions.map((_q, i) => {
      const raw = (values.memo as Record<string, unknown> | undefined)?.[i.toString()]
      return typeof raw === 'string' && raw !== '' ? raw : undefined
    })

    return memos.some((m) => m !== undefined) ? baseVote(encodedBallots, memos) : baseVote(encodedBallots)
  }

  useEffect(() => {
    if (!election || !election.questions) return

    fmethods.reset({
      ...election.questions.reduce((acc, _question, index) => ({ ...acc, [index]: '' }), {}),
    })
  }, [election, fmethods])

  return (
    <FormProvider {...fmethods}>
      <QuestionsFormContext.Provider value={{ fmethods, vote }}>{children}</QuestionsFormContext.Provider>
    </FormProvider>
  )
}
