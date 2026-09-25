import type { VotingProcessResponse } from '@vocdoni/api-types'
import { BallotType, tryInferQuestionBallotType } from '@vocdoni/ballot'
import { FieldValues } from 'react-hook-form'
import { useComponents } from '../../context/useComponents'
import { useConfirm } from '../../../confirm/useConfirm'
import { useReactComponentsLocalize } from '../../../i18n/localize'
import { resolveTitle } from '../../../election/normalized'

export type QuestionsConfirmationProps = {
  answers: FieldValues
  election: VotingProcessResponse
}

export const QuestionsConfirmation = ({ answers, election }: QuestionsConfirmationProps) => {
  const { QuestionsConfirmation: Slot } = useComponents()
  const { proceed, cancel } = useConfirm()
  const t = useReactComponentsLocalize()

  const answersView = election.questions.map((question, index) => {
    const raw = answers[index.toString()]
    // Non-throwing: the form refuses to submit an uninferable question before confirming,
    // but this dialog must not be the thing that crashes if it is ever reached anyway.
    const isSingleChoice = tryInferQuestionBallotType(question) === BallotType.SingleChoice

    // Resolve each selected choice VALUE to its title.
    const titleForValue = (value: number) => {
      const choice = question.choices.find((c) => c.value === value)
      return choice ? resolveTitle(choice.title) : t('vote.abstain')
    }

    const selectedValues = isSingleChoice
      ? raw !== undefined && raw !== '' ? [Number(raw)] : []
      : Array.isArray(raw) ? raw.map((value) => Number(value)) : []

    return {
      question: resolveTitle(question.title),
      answers: selectedValues.length ? selectedValues.map(titleForValue) : [''],
    }
  })

  return (
    <Slot
      election={election}
      answers={answers}
      answersView={answersView}
      onConfirm={() => proceed?.()}
      onCancel={() => cancel?.()}
    />
  )
}
