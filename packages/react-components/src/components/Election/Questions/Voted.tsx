import { ReactNode } from 'react'
import { useElection } from '@vocdoni/react-providers'
import { useReactComponentsLocalize } from '../../../i18n/localize'
import { resolveTitle } from '../../../election/normalized'
import type { VotedVote } from '../../context/types'
import { useComponents } from '../../context/useComponents'

/**
 * Splits `text` around every occurrence of `id` and renders the id as a link to
 * `url`, so the vote id stays clickable wherever a translation places it. Without
 * a `url` (unknown network) the text is returned as is.
 */
const linkifyVoteId = (text: string, id: string, url: string | undefined): ReactNode => {
  const parts = text.split(id)
  if (parts.length < 2 || !url) return text

  return parts.reduce<ReactNode[]>((acc, part, index) => {
    acc.push(part)
    if (index < parts.length - 1) {
      acc.push(
        <a key={`link-${index}`} href={url} target='_blank' rel='noreferrer'>
          {id}
        </a>
      )
    }
    return acc
  }, [])
}

export const Voted = () => {
  const { election, voteIds, voteId, explorerUrl } = useElection()
  const { Voted: Slot } = useComponents()
  const t = useReactComponentsLocalize()

  // Votes are relayed per question, so the voter holds one id per question they
  // answered. Walk the process's questions rather than the id map, to keep the
  // order they were asked in and to pair every id with its title.
  const ids: Record<string, string> = voteIds ?? {}
  const matched = (election?.questions ?? [])
    .filter((question) => ids[question.id])
    .map((question) => ({
      questionId: question.id,
      questionTitle: resolveTitle(question.title),
      voteId: ids[question.id],
    }))

  // An id whose question is missing from the process read still belongs to the
  // voter — show it (untitled) instead of dropping it.
  const titled = new Set(matched.map((vote) => vote.questionId))
  const entries = [
    ...matched,
    ...Object.entries(ids)
      .filter(([questionId]) => !titled.has(questionId))
      .map(([questionId, id]) => ({ questionId, questionTitle: '', voteId: id })),
  ]

  // Fallback for a provider that predates `voteIds`: the single legacy id.
  if (entries.length === 0 && voteId) {
    entries.push({ questionId: '', questionTitle: '', voteId })
  }

  if (entries.length === 0) return null

  const verifyUrl = (id: string) => (explorerUrl && id ? `${explorerUrl}/verify/${encodeURIComponent(id)}` : undefined)

  const votes: VotedVote[] = entries.map((entry) => {
    // One vote id needs no title to disambiguate it, and an untitled question
    // has none to show — both read better as the plain singular sentence.
    const text =
      entries.length === 1 || !entry.questionTitle
        ? t('vote.voted_description', { id: entry.voteId })
        : t('vote.voted_question_description', {
            title: entry.questionTitle,
            id: entry.voteId,
            defaultValue: `Your vote id for "${entry.questionTitle}" is ${entry.voteId}.`,
          })

    const url = verifyUrl(entry.voteId)
    return { ...entry, url, description: linkifyVoteId(text, entry.voteId, url) }
  })

  // Every line joined, so overrides written against the old single-string
  // `description` still surface all of the voter's ids.
  const description: ReactNode =
    votes.length === 1
      ? votes[0].description
      : votes.map((vote, index) => <span key={vote.questionId || index}>{vote.description}</span>)

  return <Slot title={t('vote.voted_title')} description={description} votes={votes} />
}
