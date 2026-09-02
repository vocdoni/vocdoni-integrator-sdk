import type { Choice, VotingProcessQuestion } from '@vocdoni/api-types'
import { BallotType, inferQuestionBallotType, questionSelectionRange } from '@vocdoni/ballot'
import { Controller, useFormContext } from 'react-hook-form'
import { QuestionChoicePresentation, QuestionLayout, QuestionSelectionMode } from '../../context/types'
import { useComponents } from '../../context/useComponents'
import { useReactComponentsLocalize } from '../../../i18n/localize'
import { useElection } from '@vocdoni/react-providers'
import { getQuestionChoiceMeta, hasExtendedChoiceMeta, QuestionChoice, QuestionRankChoice } from './Choice'
import { QuestionTip } from './Tip'
import { resolveTitle } from '../../../election/normalized'

export type QuestionProps = {
  question: VotingProcessQuestion
  index: string
}

// Approval and multichoice present as checkboxes ('multiple'), ranked as a rank widget,
// everything else as radios ('single').
const selectionModeForType = (ballotType: BallotType): QuestionSelectionMode => {
  if (ballotType === BallotType.Ranked) return 'ranked'
  return ballotType === BallotType.MultiChoice || ballotType === BallotType.Approval ? 'multiple' : 'single'
}

const getQuestionPresentation = (question: VotingProcessQuestion): QuestionChoicePresentation =>
  question.choices.some(hasExtendedChoiceMeta) ? 'extended' : 'basic'

/**
 * Whether a choice has an image worth laying out a grid cell for.
 *
 * Reads through {@link getQuestionChoiceMeta} rather than `choice.meta` directly
 * so it applies the same trimming as the presentation check — an empty or
 * whitespace-only URL is not an image, and must not flip the question to `grid`
 * with nothing to show in it.
 */
const hasChoiceImage = (choice: Choice): boolean => Boolean(getQuestionChoiceMeta(choice).image)

const getQuestionLayout = (question: VotingProcessQuestion): QuestionLayout =>
  question.choices.some(hasChoiceImage) ? 'grid' : 'list'

export const ElectionQuestion = ({ question, index }: QuestionProps) => {
  const { election } = useElection()
  const { ElectionQuestion: Slot } = useComponents()
  const {
    formState: { errors },
  } = useFormContext()
  const layout = getQuestionLayout(question)
  const hasExtendedChoices = question.choices.some(hasExtendedChoiceMeta)
  const selectionMode = selectionModeForType(inferQuestionBallotType(question))
  const invalid = Boolean((errors as Record<string, unknown>)[index])
  const description = resolveTitle((question as any).description)

  return (
    <Slot
      question={question}
      index={index}
      layout={layout}
      invalid={invalid}
      hasExtendedChoices={hasExtendedChoices}
      selectionMode={selectionMode}
      title={resolveTitle(question.title)}
      description={description || undefined}
      fields={
        <FieldSwitcher
          question={question}
          index={index}
          layout={layout}
          presentation={getQuestionPresentation(question)}
        />
      }
      tip={<QuestionTip question={question} index={index} />}
    />
  )
}

const FieldSwitcher = (props: QuestionProps & { layout: QuestionLayout; presentation: QuestionChoicePresentation }) => {
  const { election } = useElection()
  if (!election) return null

  switch (inferQuestionBallotType(props.question)) {
    case BallotType.MultiChoice:
      return <MultiChoice {...props} />
    case BallotType.Approval:
      return <ApprovalChoice {...props} />
    case BallotType.Ranked:
      return <RankedChoice {...props} />
    default:
      return <SingleChoice {...props} />
  }
}

/**
 * Ranked question: the form value is the voter's **ordering** — a `string[]` of choice
 * values, index 0 = top pick, `''` for unfilled slots (always `choices.length` long).
 * `QuestionsFormProvider` converts it to wire ranks with `rankedOrderToScores`; the
 * highest-is-best orientation never enters this component. Assigning a taken position
 * swaps the two options rather than refusing, so a reorder is one step, not two.
 */
const RankedChoice = ({
  index,
  question,
  layout,
  presentation,
}: QuestionProps & { layout: QuestionLayout; presentation: QuestionChoicePresentation }) => {
  const { status, isAbleToVote } = useElection()
  const t = useReactComponentsLocalize()
  const { control, trigger } = useFormContext()
  const { QuestionsError } = useComponents()

  const total = question.choices.length
  const disabled = status !== 'ONGOING' || !isAbleToVote

  return (
    <Controller
      control={control}
      disabled={disabled}
      name={index}
      rules={{
        // All or nothing: a partial ranking repeats a rank and the chain discards the
        // whole ballot at tally. questionSelectionRange reports {min: n, max: n}.
        validate: (value: string[]) => {
          const ranked = (Array.isArray(value) ? value : []).filter((entry) => entry !== '' && entry != null)
          if (ranked.length === total) return true
          return t('validation.rank_all', { count: total, defaultValue: `Rank all ${total} options` })
        },
      }}
      render={({ field, fieldState }) => {
        const order: string[] = Array.isArray(field.value) ? [...field.value] : []
        while (order.length < total) order.push('')

        const assign = (value: string, position: number | null) => {
          const next = [...order]
          const from = next.indexOf(value)

          if (position === null) {
            if (from >= 0) next[from] = ''
          } else {
            const to = position - 1
            const displaced = next[to]
            next[to] = value
            // Swap: the displaced option takes the slot the moved one vacated. If the
            // moved one was unranked there is no vacated slot, so the displaced option
            // falls into the first free position rather than being silently dropped.
            if (from >= 0) {
              next[from] = displaced
            } else if (displaced !== '') {
              const free = next.indexOf('')
              // `free` is only ever -1 when nothing was displaced.
              if (free >= 0) next[free] = displaced
            }
          }

          field.onChange(next)
          trigger(index)
        }

        // Same labels for every option — build once per render, not n² per keystroke.
        const positionLabels = Array.from({ length: total }, (_, i) =>
          t('vote.rank_position', { position: i + 1, defaultValue: `#${i + 1}` })
        )

        return (
          <>
            {question.choices.map((choice: Choice) => {
              const value = choice.value.toString()
              const at = order.indexOf(value)

              return (
                <QuestionRankChoice
                  key={value}
                  choice={choice}
                  value={value}
                  compact={!hasChoiceImage(choice) && layout === 'list'}
                  presentation={presentation}
                  dataAttrs={{
                    'data-choice-card': '',
                    'data-choice-control': '',
                    'data-choice-body': '',
                    'data-choice-media': '',
                    'data-layout': layout,
                    'data-choice-id-base': `question-${index}-choice-${value}`,
                    'data-choice-field-name': field.name,
                  }}
                  position={at >= 0 ? at + 1 : null}
                  options={positionLabels.map((label, i) => ({
                    position: i + 1,
                    label,
                    // Marked, not removed — picking a taken slot swaps the two options.
                    taken: order[i] !== '' && order[i] !== value,
                  }))}
                  disabled={disabled}
                  onRank={(position) => assign(value, position)}
                />
              )
            })}
            {fieldState.error?.message ? <QuestionsError error={fieldState.error.message} variant='field' /> : null}
          </>
        )
      }}
    />
  )
}

const MultiChoice = ({
  index,
  question,
  layout,
  presentation,
}: QuestionProps & { layout: QuestionLayout; presentation: QuestionChoicePresentation }) => {
  const { status, isAbleToVote } = useElection()
  const t = useReactComponentsLocalize()
  const { control, trigger } = useFormContext()
  const { QuestionsError } = useComponents()

  // The pick bound, not ballotProtocol.maxCount — on the dense layout maxCount is
  // the number of choices, and the bound lives in maxTotalCost.
  const { max: maxCount } = questionSelectionRange(question)
  const disabled = status !== 'ONGOING' || !isAbleToVote

  return (
    <Controller
      control={control}
      disabled={disabled}
      name={index}
      rules={{
        validate: (value: string[]) => {
          const count = Array.isArray(value) ? value.length : 0
          const { min, max } = questionSelectionRange(question)
          if (count >= min && count <= max) return true
          return min === max
            ? t('validation.choices_count', { count: max })
            : t('validation.choices_range', {
                min,
                max,
                defaultValue: `Select between ${min} and ${max} options`,
              })
        },
      }}
      render={({ field, fieldState }) => {
        const currentValues: string[] = Array.isArray(field.value) ? field.value : []

        return (
          <>
            {question.choices.map((choice: Choice) => {
              const value = choice.value.toString()
              const maxSelected = currentValues.length >= maxCount && !currentValues.includes(value)

              return (
                <QuestionChoice
                  key={value}
                  choice={choice}
                  value={value}
                  controlType='checkbox'
                  selectionMode='multiple'
                  presentation={presentation}
                  compact={!hasChoiceImage(choice) && layout === 'list'}
                  dataAttrs={{
                    'data-choice-card': '',
                    'data-choice-control': '',
                    'data-choice-body': '',
                    'data-choice-media': '',
                    'data-layout': layout,
                    'data-choice-id-base': `question-${index}-choice-${value}`,
                    'data-choice-field-name': field.name,
                  }}
                  selected={currentValues.includes(value)}
                  disabled={disabled || maxSelected}
                  onSelect={(checked) => {
                    if (checked && maxSelected) return

                    const next = checked
                      ? [...currentValues, value]
                      : currentValues.filter((currentValue) => currentValue !== value)

                    field.onChange(next)
                    trigger(index)
                  }}
                />
              )
            })}
            {fieldState.error?.message ? <QuestionsError error={fieldState.error.message} variant='field' /> : null}
          </>
        )
      }}
    />
  )
}

const ApprovalChoice = ({
  index,
  question,
  layout,
  presentation,
}: QuestionProps & { layout: QuestionLayout; presentation: QuestionChoicePresentation }) => {
  const { status, isAbleToVote } = useElection()
  const { control } = useFormContext()
  const { QuestionsError } = useComponents()
  const t = useReactComponentsLocalize()

  const disabled = status !== 'ONGOING' || !isAbleToVote

  return (
    <Controller
      control={control}
      disabled={disabled}
      name={index}
      rules={{
        validate: (value: string[]) =>
          (value && value.length > 0) || t('validation.at_least_one', { defaultValue: 'Select at least one option' }),
      }}
      render={({ field, fieldState }) => {
        const currentValues: string[] = Array.isArray(field.value) ? field.value : []
        return (
          <>
            {question.choices.map((choice: Choice) => {
              const value = choice.value.toString()
              return (
                <QuestionChoice
                  key={value}
                  choice={choice}
                  value={value}
                  controlType='checkbox'
                  selectionMode='multiple'
                  presentation={presentation}
                  compact={!hasChoiceImage(choice) && layout === 'list'}
                  dataAttrs={{
                    'data-choice-card': '',
                    'data-choice-control': '',
                    'data-choice-body': '',
                    'data-choice-media': '',
                    'data-layout': layout,
                    'data-choice-id-base': `question-${index}-choice-${value}`,
                    'data-choice-field-name': field.name,
                  }}
                  selected={currentValues.includes(value)}
                  disabled={disabled}
                  onSelect={(checked) => {
                    const next = checked
                      ? [...currentValues, value]
                      : currentValues.filter((currentValue) => currentValue !== value)

                    field.onChange(next)
                  }}
                />
              )
            })}
            {fieldState.error?.message ? <QuestionsError error={fieldState.error.message} variant='field' /> : null}
          </>
        )
      }}
    />
  )
}

const SingleChoice = ({
  index,
  question,
  layout,
  presentation,
}: QuestionProps & { layout: QuestionLayout; presentation: QuestionChoicePresentation }) => {
  const { status, isAbleToVote } = useElection()
  const { control } = useFormContext()
  const { QuestionsError } = useComponents()
  const t = useReactComponentsLocalize()

  const disabled = status !== 'ONGOING' || !isAbleToVote

  return (
    <Controller
      control={control}
      disabled={disabled}
      name={index}
      rules={{ required: t('validation.required') }}
      render={({ field, fieldState }) => (
        <>
          {question.choices.map((choice: Choice) => (
            <QuestionChoice
              key={choice.value}
              choice={choice}
              value={choice.value.toString()}
              controlType='radio'
              selectionMode='single'
              presentation={presentation}
              compact={!hasChoiceImage(choice) && layout === 'list'}
              dataAttrs={{
                'data-choice-card': '',
                'data-choice-control': '',
                'data-choice-body': '',
                'data-choice-media': '',
                'data-layout': layout,
              }}
              selected={field.value === choice.value.toString()}
              disabled={disabled}
              onSelect={(checked) => {
                if (!checked) return
                field.onChange(choice.value.toString())
              }}
            />
          ))}
          {fieldState.error?.message ? <QuestionsError error={fieldState.error.message} variant='field' /> : null}
        </>
      )}
    />
  )
}
