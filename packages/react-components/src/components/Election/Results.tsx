import { decodeQuestionResults, questionReservesAbstain, tryInferQuestionBallotType } from '@vocdoni/ballot'
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
  const anySecretNotFinal = election.questions.some((q) => {
    const qResults = resultsByQuestionId.get(q.id)
    return q.secretUntilTheEnd && !qResults?.finalResults && !forceRender
  })

  if (anySecretNotFinal) {
    const endDate = election.endDate ? new Date(election.endDate) : null
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
    // No derivable ballot type (e.g. a legacy election projected without one): the
    // results matrix cannot be read without knowing its layout, so list the choices
    // with no tally rather than guess one — or throw and take down every other question.
    if (tryInferQuestionBallotType(question) === undefined) {
      return {
        title: localize('results.title', { title: resolveTitle(question.title) }),
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

    // The decoder always emits the multichoice abstain bucket, so this is where it
    // gets suppressed. A protocol that reserves no sentinel headroom gives the chain
    // nowhere to record an abstention, making that bucket structurally 0 — an
    // "Abstention: 0" row on a ballot nobody can abstain on. Headroom keeps the row
    // even at zero, because there the zero is a real measurement.
    //
    // Reserving headroom is not quite the same as having sentinel *columns*: those
    // appear at maxValue >= numChoices, while headroom needs numChoices - 1 + maxCount
    // (unique ballots). A protocol landing in between can carry real abstentions it
    // does not formally reserve, so a non-zero bucket is always shown — dropping it
    // would lose a measurement and leave the remaining percentages summing to under
    // 100%, since the decoder counts abstain in the denominator either way.
    const reservesAbstain = questionReservesAbstain(question)

    return {
      title: localize('results.title', { title: resolveTitle(question.title) }),
      choices: decoded
        .filter((row) => row.choice !== 'abstain' || reservesAbstain || row.votes > 0)
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
