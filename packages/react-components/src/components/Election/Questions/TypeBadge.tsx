import type { VotingProcessQuestion } from '@vocdoni/api-types'
import { BallotType, inferQuestionBallotType, questionSelectionRange } from '@vocdoni/ballot'
import { ComponentPropsWithoutRef } from 'react'
import { useComponents } from '../../context/useComponents'
import { useReactComponentsLocalize } from '../../../i18n/localize'
import { useElection } from '@vocdoni/react-providers'

export type QuestionsTypeBadgeProps = ComponentPropsWithoutRef<'div'> &
  Record<string, unknown> & {
    /** The question to infer the ballot type from. Defaults to the first question. */
    question?: VotingProcessQuestion
  }

export const QuestionsTypeBadge = ({ question: questionProp, ...props }: QuestionsTypeBadgeProps) => {
  const { election } = useElection()
  const { QuestionsTypeBadge: Slot } = useComponents()
  const t = useReactComponentsLocalize()

  const question = questionProp ?? election?.questions[0]

  if (!question) {
    return null
  }

  // The pick bound, not ballotProtocol.maxCount — on the dense layout maxCount is
  // the number of choices, and the bound lives in maxTotalCost.
  const maxCount = questionSelectionRange(question).max
  const weighted = ''

  let title = ''
  let tooltip = ''

  switch (inferQuestionBallotType(question)) {
    case BallotType.SingleChoice:
      title = t('question_types.singlechoice_title', { weighted })
      break
    case BallotType.MultiChoice:
      title = t('question_types.multichoice_title', { weighted })
      tooltip = t('question_types.multichoice_tooltip', { maxcount: maxCount })
      break
    case BallotType.Approval:
      title = t('question_types.approval_title')
      tooltip = t('question_types.approval_tooltip', { maxcount: maxCount })
      break
    case BallotType.Ranked:
      title = t('question_types.ranked_title', { weighted })
      tooltip = t('question_types.ranked_tooltip', { maxcount: maxCount })
      break
    case BallotType.Budget:
      title = t('question_types.budget_title', { weighted })
      tooltip = t('question_types.budget_tooltip')
      break
    case BallotType.Quadratic:
      title = t('question_types.quadratic_title', { weighted })
      tooltip = t('question_types.quadratic_tooltip')
      break
  }

  if (!title) return null

  return <Slot {...props} title={title} tooltip={tooltip} />
}
