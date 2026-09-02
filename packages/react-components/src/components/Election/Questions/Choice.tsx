import type { Choice } from '@vocdoni/api-types'
import { ComponentPropsWithoutRef } from 'react'
import { QuestionChoicePresentation, QuestionRankOption, QuestionSelectionMode } from '../../context/types'
import { useComponents } from '../../context/useComponents'
import { linkifyIpfs } from '../../shared/ipfs'
import { resolveTitle } from '../../../election/normalized'

export type QuestionChoiceMeta = {
  image?: {
    default?: string
    thumbnail?: string
  }
  description?: string
}

const toNonEmpty = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined

/**
 * Read a choice's extended display info (image, description), resolving `ipfs://`
 * URLs and dropping empty/whitespace-only strings.
 *
 * The source is `choice.meta`, which the API client fills from the parent
 * question's `metadata.choices` on read — a question without those entries
 * yields an empty meta here, and so renders the basic presentation.
 */
export const getQuestionChoiceMeta = (choice: Choice): QuestionChoiceMeta => {
  const meta = choice.meta ?? {}

  const imageDefault = toNonEmpty(meta.image?.default)
  const imageThumbnail = toNonEmpty(meta.image?.thumbnail)
  const description = toNonEmpty(meta.description)
  const normalizedDefault = linkifyIpfs(imageDefault)
  const normalizedThumbnail = linkifyIpfs(imageThumbnail)

  const image =
    normalizedDefault || normalizedThumbnail
      ? { default: normalizedDefault, thumbnail: normalizedThumbnail }
      : undefined

  return {
    image,
    description,
  }
}

export const hasExtendedChoiceMeta = (choice: Choice): boolean => {
  const { image, description } = getQuestionChoiceMeta(choice)
  return Boolean(description || image?.default || image?.thumbnail)
}

/**
 * Shared by both choice wrappers below: resolve `choice.meta` once, so a change to
 * choice-meta handling reaches the ranked and tick-box paths together.
 */
const choicePresentationProps = (choice: Choice) => {
  const metadata = getQuestionChoiceMeta(choice)
  return {
    label: resolveTitle(choice.title),
    description: metadata.description,
    image: metadata.image,
    hasImage: Boolean(metadata.image?.default || metadata.image?.thumbnail),
    canOpenImageModal: Boolean(metadata.image?.thumbnail && metadata.image?.default),
  }
}

export const QuestionChoice = ({
  choice,
  value,
  compact,
  dataAttrs,
  selectionMode,
  presentation,
  selected,
  disabled,
  controlType,
  onSelect,
  ...rest
}: ComponentPropsWithoutRef<'label'> & {
  choice: Choice
  value: string
  compact: boolean
  dataAttrs?: { [key: string]: string | undefined }
  selectionMode: QuestionSelectionMode
  presentation: QuestionChoicePresentation
  selected: boolean
  disabled?: boolean
  controlType: 'checkbox' | 'radio'
  onSelect: (checked: boolean) => void
}) => {
  const { QuestionChoice: Slot } = useComponents()

  return (
    <Slot
      {...rest}
      {...choicePresentationProps(choice)}
      choice={choice}
      value={value}
      compact={compact}
      dataAttrs={dataAttrs}
      selectionMode={selectionMode}
      presentation={presentation}
      selected={selected}
      disabled={disabled}
      controlType={controlType}
      onSelect={onSelect}
    />
  )
}

/**
 * The ranked counterpart of {@link QuestionChoice}: same choice-meta resolution, but
 * the voter assigns a position instead of ticking, so it renders the
 * `QuestionRankChoice` slot with `position` / `options` / `onRank`.
 */
export const QuestionRankChoice = ({
  choice,
  value,
  compact,
  dataAttrs,
  presentation,
  position,
  options,
  disabled,
  onRank,
  ...rest
}: ComponentPropsWithoutRef<'label'> & {
  choice: Choice
  value: string
  compact: boolean
  dataAttrs?: { [key: string]: string | undefined }
  presentation: QuestionChoicePresentation
  position: number | null
  options: QuestionRankOption[]
  disabled?: boolean
  onRank: (position: number | null) => void
}) => {
  const { QuestionRankChoice: Slot } = useComponents()

  return (
    <Slot
      {...rest}
      {...choicePresentationProps(choice)}
      choice={choice}
      value={value}
      compact={compact}
      dataAttrs={dataAttrs}
      presentation={presentation}
      position={position}
      options={options}
      disabled={disabled}
      onRank={onRank}
    />
  )
}
