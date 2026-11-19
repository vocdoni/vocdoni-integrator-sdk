import { decodeQuestionResults, questionReservesAbstain, tryInferQuestionBallotType } from '@vocdoni/ballot'
import { questionsEndedAt, resolveEndDate } from '@vocdoni/api-client'
import { format } from 'date-fns'
import { ComponentPropsWithoutRef } from 'react'
import { useComponents } from '../context/useComponents'
import { linkifyIpfs } from '../shared/ipfs'
import { useReactComponentsLocalize } from '../../i18n/localize'
import { useElection } from '@vocdoni/react-providers'
import { resolveTitle } from '../../election/normalized'

const formatPercent = (pct: number | null) => (pct ?? 0).toFixed(1) + '%'

export type ElectionResultsProps = ComponentPropsWithoutRef<'div'> & {
  forceRender?: boolean
}

export const ElectionResults = ({ forceRender, ...rest }: ElectionResultsProps) => {
  const { election, status, results } = useElection()
  const localize = useReactComponentsLocalize()
  const { ElectionResults: Slot } = useComponents()

  if (!election || status === 'CANCELED') return null

  // Results entries are keyed by question id — never pair by array position,
  // since the backend omits not-yet-published questions and guarantees no order.
  const resultsByQuestionId = new Map(
    (results?.questions ?? []).map((qResults) => [qResults.questionId, qResults])
  )

  // Secret-until-the-end: show placeholder if any question is still secret
  // and its results are not yet final.
  const blockingQuestions = forceRender
    ? []
    : election.questions.filter((q) => q.secretUntilTheEnd && !resultsByQuestionId.get(q.id)?.finalResults)
  const anySecretNotFinal = blockingQuestions.length > 0

  if (anySecretNotFinal) {
    // The process-level `endedAt` is omitted while any question is still open,
    // but the placeholder only waits on the secret questions: once they have all
    // ended, the latest of their own `endedAt` is when voting really stopped.
    const endDate = questionsEndedAt(blockingQuestions) ?? resolveEndDate(election)
    return (
      <Slot
        {...rest}
        secretText={localize('results.secret_until_the_end', {
          endDate: endDate ? format(endDate, localize('results.date_format')) : '',
        })}
      />
    )
  }

  const questions = election.questions.map((question) => {
    const title = localize('results.title', { title: resolveTitle(question.title) })

    // No derivable ballot type (e.g. a legacy election projected without one): the
    // results matrix cannot be read without knowing its layout, so list the choices
    // with no tally rather than guess one — or throw and take down every other question.
    if (tryInferQuestionBallotType(question) === undefined) {
      return {
        title,
        choices: question.choices.map((choice) => ({
          title: resolveTitle(choice.title),
          votes: '',
          percent: '',
          image: linkifyIpfs(choice.meta?.image?.default),
        })),
      }
    }

    const rawResults = resultsByQuestionId.get(question.id)?.results ?? []
    const decoded = decodeQuestionResults(question, rawResults)
    const choiceByValue = new Map(question.choices.map((choice) => [choice.value, choice]))

    return {
      title,
      choices: decoded
        // Same rule as ballot's isAbstainVisible, inlined while the ballot peer range
        // still admits releases without it.
        .filter((row) => row.choice !== 'abstain' || row.votes > 0 || questionReservesAbstain(question))
        .map((row) => {
          if (row.choice === 'abstain') {
            return {
              title: localize('vote.abstain'),
              votes: String(row.votes),
              percent: formatPercent(row.percentage),
              image: undefined,
            }
          }

          const choice = choiceByValue.get(row.choice)
          const image = choice?.meta?.image?.default

          return {
            title: choice ? resolveTitle(choice.title) : String(row.choice),
            votes: String(row.votes),
            percent: formatPercent(row.percentage),
            image: linkifyIpfs(image),
          }
        }),
    }
  })

  return <Slot {...rest} questions={questions} />
}
