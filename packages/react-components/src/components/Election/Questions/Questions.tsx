import type { VotingProcessQuestion } from '@vocdoni/api-types'
import { ComponentPropsWithoutRef } from 'react'
import { useComponents } from '../../context/useComponents'
import { useReactComponentsLocalize } from '../../../i18n/localize'
import { useElection } from '@vocdoni/react-providers'
import { ElectionQuestion } from './Fields'
import { QuestionsFormProvider, QuestionsFormProviderProps, useQuestionsForm } from './Form'
import { Voted } from './Voted'

export type ElectionQuestionsFormProps = ComponentPropsWithoutRef<'div'> & {
  onInvalid?: (errors: unknown) => void
}

export type ElectionQuestionsProps = ElectionQuestionsFormProps & QuestionsFormProviderProps

export const ElectionQuestions = (props: ElectionQuestionsProps) => (
  <QuestionsFormProvider>
    <ElectionQuestionsForm {...props} />
  </QuestionsFormProvider>
)

export const ElectionQuestionsForm = ({ onInvalid, ...rest }: ElectionQuestionsFormProps) => {
  const { election } = useElection()
  const { ElectionQuestions: Slot } = useComponents()

  if (!election) return null

  return <Slot {...rest} form={<QuestionsFormContents onInvalid={onInvalid} />} />
}

const QuestionsFormContents = ({ onInvalid }: { onInvalid?: (errors: unknown) => void }) => {
  const { election, hasVoted, isAbleToVote } = useElection()
  const { QuestionsEmpty, QuestionsError } = useComponents()
  const t = useReactComponentsLocalize()
  const { fmethods, vote } = useQuestionsForm()
  const questions: VotingProcessQuestion[] | undefined = election?.questions

  if (hasVoted && !isAbleToVote) {
    return <Voted />
  }

  if (!questions || !questions.length) {
    return <QuestionsEmpty text={t('empty')} />
  }

  // Why the cast failed, set by the form's vote handler. Form-level rather
  // than per-field: the chain rejects the batch, not one answer. RHF clears
  // `root` errors when the form is submitted again, so a retry starts clean.
  const voteError = fmethods.formState.errors.root?.vote?.message

  return (
    <form onSubmit={fmethods.handleSubmit(vote, onInvalid)} id={`election-questions-${election!.id}`}>
      <Voted />
      {questions.map((question, index) => (
        <ElectionQuestion key={index} index={index.toString()} question={question} />
      ))}
      {voteError ? <QuestionsError error={String(voteError)} variant='form' /> : null}
    </form>
  )
}
