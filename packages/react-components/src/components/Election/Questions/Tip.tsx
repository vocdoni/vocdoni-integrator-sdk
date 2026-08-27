import type { VotingProcessQuestion } from '@vocdoni/api-types'
import { BallotType, inferQuestionBallotType, questionSelectionRange } from '@vocdoni/ballot'
import { useWatch } from 'react-hook-form'
import { useComponents } from '../../context/useComponents'
import { useReactComponentsLocalize } from '../../../i18n/localize'
import { useQuestionsForm } from './Form'

export const QuestionTip = ({ question, index = '0' }: { question?: VotingProcessQuestion; index?: string }) => {
  const { QuestionTip: Slot } = useComponents()
  const {
    fmethods: { control },
  } = useQuestionsForm()
  const t = useReactComponentsLocalize()
  // Subscribe to this question's own field so the count follows the voter's
  // selections — getValues() is a snapshot and never re-renders the tip.
  const value = useWatch({ control, name: index })

  if (!question) return null

  const ballotType = inferQuestionBallotType(question)
  if (ballotType !== BallotType.MultiChoice && ballotType !== BallotType.Ranked) return null

  const ranked = ballotType === BallotType.Ranked
  const entries = Array.isArray(value) ? value : []
  const text = t(ranked ? 'question_types.ranked_desc' : 'question_types.multichoice_desc', {
    // Ranked is all-or-nothing, so the tip counts *placed* options rather than picks —
    // an empty slot in the middle of the slate is the one thing blocking the vote, and
    // the form value carries '' for it.
    selected: ranked ? entries.filter((entry) => entry !== '' && entry != null).length : entries.length,
    // The pick bound, not ballotProtocol.maxCount — on the dense layout maxCount is the
    // number of choices, and the bound lives in maxTotalCost.
    maxcount: questionSelectionRange(question).max,
  })

  if (!text) return null

  return <Slot text={text} />
}
