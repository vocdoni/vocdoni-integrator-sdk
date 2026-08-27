import type { Choice, Question, VotingProcessResponse } from '@vocdoni/api-types'
import { ComponentPropsWithoutRef, ComponentType, FormEvent, HTMLAttributes, ReactNode } from 'react'
import { FieldValues, UseFormRegisterReturn } from 'react-hook-form'

type BaseProps<T extends HTMLElement = HTMLElement> = Omit<HTMLAttributes<T>, 'children'>

export type ElectionTitleSlotProps = BaseProps<HTMLHeadingElement> & { title: string }
export type ElectionDescriptionSlotProps = BaseProps<HTMLDivElement> & { description: string }
export type ElectionScheduleSlotProps = BaseProps<HTMLParagraphElement> & { text: string }
export type ElectionStatusBadgeSlotProps = BaseProps<HTMLSpanElement> & {
  label: string
  tone: 'success' | 'warning' | 'danger'
}
export type ElectionHeaderSlotProps = BaseProps<HTMLImageElement> & { src?: string; alt?: string }
export type QuestionsTypeBadgeSlotProps = BaseProps<HTMLDivElement> & { title: string; tooltip?: string }
export type QuestionTipSlotProps = BaseProps<HTMLDivElement> & { text: string }
export type QuestionsEmptySlotProps = BaseProps<HTMLDivElement> & { text: string }
export type QuestionsErrorSlotProps = BaseProps<HTMLDivElement> & { error: string; variant?: 'field' | 'form' }
/** One voted question's vote id, as rendered by the `Voted` slot. */
export type VotedVote = {
  questionId: string
  /** Resolved question title — empty when the question is no longer in the process. */
  questionTitle: string
  /** The vote id (nullifier) of that question's vote. */
  voteId: string
  /** Ready-to-render line for this vote, with the id link-ified. */
  description: ReactNode
}

export type VotedSlotProps = BaseProps<HTMLDivElement> & {
  title: string
  /**
   * Every vote's line, joined — one per voted question. Kept so existing
   * overrides keep rendering all the information; prefer {@link votes} to lay
   * the entries out yourself.
   */
  description: ReactNode
  /** One entry per voted question, in process order. */
  votes: VotedVote[]
}
export type VoteButtonSlotProps = BaseProps<HTMLButtonElement> & {
  label: ReactNode
  form?: string
  disabled?: boolean
  loading?: boolean
  type?: 'button' | 'submit'
  onClick?: () => void | Promise<void>
}
export type VoteWeightSlotProps = BaseProps<HTMLDivElement> & { label: string; weight: number }

export type ElectionResultChoice = {
  title: string
  votes: string
  percent: string
  description?: string
  image?: string
}

export type ElectionResultQuestion = {
  title: string
  choices: ElectionResultChoice[]
}

export type ElectionResultsSlotProps = BaseProps<HTMLDivElement> & {
  secretText?: string
  questions?: ElectionResultQuestion[]
}

export type SpreadsheetInputField = {
  id: string
  label: string
  description?: string
  error?: string
  inputProps: UseFormRegisterReturn
  inputAttrs?: {
    type?: string
    min?: number
    max?: number
  }
}

export type SpreadsheetAccessSlotProps = BaseProps<HTMLDivElement> & {
  connected: boolean
  loading: boolean
  formError?: string
  title: string
  open: boolean
  onOpen: () => void
  onClose: () => void
  onLogout: () => void
  onSubmit: (event?: FormEvent<HTMLFormElement>) => void
  fields: SpreadsheetInputField[]
  anonymousField?: SpreadsheetInputField
  extraFields?: ReactNode
}

export type ElectionActionsSlotProps = BaseProps<HTMLDivElement> & { actions?: ReactNode }

export type ActionButtonSlotProps = BaseProps<HTMLButtonElement> & {
  label: ReactNode
  disabled?: boolean
  loading?: boolean
  onClick?: () => void | Promise<void>
}

export type ConfirmActionModalSlotProps = BaseProps<HTMLDivElement> & {
  title: string
  description: string
  confirm: string
  cancel: string
  onConfirm: () => void
  onCancel: () => void
}
export type ConfirmShellSlotProps = Omit<BaseProps<HTMLDivElement>, 'content'> & {
  isOpen: boolean
  onClose: () => void
  content: ReactNode
}

export type AccountBalanceSlotProps = BaseProps<HTMLSpanElement> & {
  balance: number
  tone: 'success' | 'warning' | 'danger'
  label: string
}

export type PaginationContainerSlotProps = BaseProps<HTMLDivElement> & {
  items?: ReactNode
}

export type PaginationButtonSlotProps = {
  label?: ReactNode
  isActive?: boolean
  disabled?: boolean
  href?: string
  className?: string
  type?: 'button' | 'submit' | 'reset'
  onClick?: (...args: any[]) => void
}

export type PaginationEllipsisButtonSlotProps = {
  className?: string
  isInput: boolean
  placeholder: string
  onToggle: () => void
  onSubmitPage: (page: number) => void
  buttonProps?: ComponentPropsWithoutRef<'button'>
  inputProps?: ComponentPropsWithoutRef<'input'>
}

export type PaginationSummarySlotProps = BaseProps<HTMLParagraphElement> & {
  text: string
}

export type ElectionQuestionsSlotProps = BaseProps<HTMLDivElement> & { form?: ReactNode }
/**
 * How a question asks for its answer: `single` = one-of-N (radios), `multiple` =
 * any-of-N (checkboxes), `ranked` = an ordering of every option, rendered through
 * {@link QuestionRankChoiceSlotProps}.
 */
export type QuestionSelectionMode = 'single' | 'multiple' | 'ranked'
export type QuestionChoicePresentation = 'basic' | 'extended'
export type QuestionLayout = 'list' | 'grid'

export type ElectionQuestionSlotProps = BaseProps<HTMLDivElement> & {
  question: Question
  index: string
  layout: QuestionLayout
  invalid: boolean
  hasExtendedChoices: boolean
  selectionMode: QuestionSelectionMode
  title: string
  description?: string
  fields: ReactNode
  tip?: ReactNode
}

export type QuestionChoiceSlotProps = BaseProps<HTMLLabelElement> & {
  choice: Choice
  value: string
  label: string
  description?: string
  image?: {
    default?: string
    thumbnail?: string
  }
  compact: boolean
  hasImage: boolean
  canOpenImageModal: boolean
  dataAttrs?: { [key: string]: string | undefined }
  presentation: QuestionChoicePresentation
  selectionMode: QuestionSelectionMode
  selected: boolean
  disabled?: boolean
  controlType: 'checkbox' | 'radio'
  onSelect: (checked: boolean) => void
}

/** One selectable rank position offered for a choice by {@link QuestionRankChoiceSlotProps}. */
export type QuestionRankOption = {
  /** 1-based position: 1 is the voter's top pick. */
  position: number
  /** Ready-to-render label for the position, localized via `vote.rank_position` (default: "#1", "#2", …). */
  label: string
  /** True when another choice already holds this position. */
  taken: boolean
}

/**
 * One option of a **ranked** question: the voter assigns it a position rather than
 * ticking it, hence a separate slot from {@link QuestionChoiceSlotProps}. The default
 * renders a `<select>`; override for drag-and-drop or numbered buttons. `position` is
 * 1-based and human — the wire orientation (highest = best) is applied later by
 * `@vocdoni/ballot`'s `rankedOrderToScores`, never by this slot.
 */
export type QuestionRankChoiceSlotProps = BaseProps<HTMLLabelElement> & {
  choice: Choice
  value: string
  label: string
  description?: string
  image?: {
    default?: string
    thumbnail?: string
  }
  compact: boolean
  hasImage: boolean
  canOpenImageModal: boolean
  dataAttrs?: { [key: string]: string | undefined }
  presentation: QuestionChoicePresentation
  /** The position this choice currently holds, or `null` while it is unranked. */
  position: number | null
  /** Every position the voter may assign, in order. */
  options: QuestionRankOption[]
  disabled?: boolean
  /** Assign this choice a position, or `null` to unrank it. */
  onRank: (position: number | null) => void
}

export type QuestionsConfirmationAnswerItem = {
  question: string
  answers: string[]
}

export type QuestionsConfirmationSlotProps = BaseProps<HTMLDivElement> & {
  election: VotingProcessResponse
  answers: FieldValues
  answersView: QuestionsConfirmationAnswerItem[]
  onConfirm: () => void
  onCancel: () => void
}

export type OrganizationNameSlotProps = BaseProps<HTMLHeadingElement> & { name: string }
export type OrganizationDescriptionSlotProps = BaseProps<HTMLDivElement> & { description: string }
export type OrganizationAvatarSlotProps = BaseProps<HTMLImageElement> & { src?: string; alt?: string }

export type ComponentsDefinition<ExternalProps extends object = {}> = {
  HR: ComponentType<BaseProps<HTMLHRElement> & ExternalProps>
  ElectionTitle: ComponentType<ElectionTitleSlotProps & ExternalProps>
  ElectionDescription: ComponentType<ElectionDescriptionSlotProps & ExternalProps>
  ElectionSchedule: ComponentType<ElectionScheduleSlotProps & ExternalProps>
  ElectionStatusBadge: ComponentType<ElectionStatusBadgeSlotProps & ExternalProps>
  ElectionHeader: ComponentType<ElectionHeaderSlotProps & ExternalProps>
  ElectionQuestions: ComponentType<ElectionQuestionsSlotProps & ExternalProps>
  ElectionQuestion: ComponentType<ElectionQuestionSlotProps & ExternalProps>
  QuestionChoice: ComponentType<QuestionChoiceSlotProps & ExternalProps>
  QuestionRankChoice: ComponentType<QuestionRankChoiceSlotProps & ExternalProps>
  QuestionsTypeBadge: ComponentType<QuestionsTypeBadgeSlotProps & ExternalProps>
  QuestionTip: ComponentType<QuestionTipSlotProps & ExternalProps>
  QuestionsEmpty: ComponentType<QuestionsEmptySlotProps & ExternalProps>
  QuestionsError: ComponentType<QuestionsErrorSlotProps & ExternalProps>
  QuestionsConfirmation: ComponentType<QuestionsConfirmationSlotProps & ExternalProps>
  Voted: ComponentType<VotedSlotProps & ExternalProps>
  VoteButton: ComponentType<VoteButtonSlotProps & ExternalProps>
  VoteWeight: ComponentType<VoteWeightSlotProps & ExternalProps>
  ElectionResults: ComponentType<ElectionResultsSlotProps & ExternalProps>
  SpreadsheetAccess: ComponentType<SpreadsheetAccessSlotProps & ExternalProps>
  ElectionActions: ComponentType<ElectionActionsSlotProps & ExternalProps>
  ActionContinue: ComponentType<ActionButtonSlotProps & ExternalProps>
  ActionPause: ComponentType<ActionButtonSlotProps & ExternalProps>
  ActionEnd: ComponentType<ActionButtonSlotProps & ExternalProps>
  ActionCancel: ComponentType<ActionButtonSlotProps & ExternalProps>
  ConfirmActionModal: ComponentType<ConfirmActionModalSlotProps & ExternalProps>
  ConfirmShell: ComponentType<ConfirmShellSlotProps & ExternalProps>
  AccountBalance: ComponentType<AccountBalanceSlotProps & ExternalProps>
  PaginationContainer: ComponentType<PaginationContainerSlotProps & ExternalProps>
  PaginationButton: ComponentType<PaginationButtonSlotProps & ExternalProps>
  PaginationEllipsisButton: ComponentType<PaginationEllipsisButtonSlotProps & ExternalProps>
  PaginationSummary: ComponentType<PaginationSummarySlotProps & ExternalProps>
  OrganizationName: ComponentType<OrganizationNameSlotProps & ExternalProps>
  OrganizationDescription: ComponentType<OrganizationDescriptionSlotProps & ExternalProps>
  OrganizationAvatar: ComponentType<OrganizationAvatarSlotProps & ExternalProps>
}

export type ComponentsPartialDefinition<ExternalProps extends object = {}> = Partial<
  ComponentsDefinition<ExternalProps>
>

export type ElectionComponentsDefinition = Pick<
  ComponentsDefinition,
  | 'ElectionTitle'
  | 'ElectionDescription'
  | 'ElectionSchedule'
  | 'ElectionStatusBadge'
  | 'ElectionHeader'
  | 'ElectionQuestions'
  | 'ElectionQuestion'
  | 'QuestionChoice'
  | 'QuestionRankChoice'
  | 'QuestionsTypeBadge'
  | 'QuestionTip'
  | 'QuestionsEmpty'
  | 'QuestionsError'
  | 'QuestionsConfirmation'
  | 'Voted'
  | 'VoteButton'
  | 'VoteWeight'
  | 'ElectionResults'
  | 'SpreadsheetAccess'
  | 'ElectionActions'
  | 'ActionContinue'
  | 'ActionPause'
  | 'ActionEnd'
  | 'ActionCancel'
  | 'ConfirmActionModal'
  | 'ConfirmShell'
>

export type OrganizationComponentsDefinition = Pick<
  ComponentsDefinition,
  'OrganizationName' | 'OrganizationDescription' | 'OrganizationAvatar'
>

export type PaginationComponentsDefinition = Pick<
  ComponentsDefinition,
  'PaginationContainer' | 'PaginationButton' | 'PaginationEllipsisButton' | 'PaginationSummary'
>

export type AccountComponentsDefinition = Pick<ComponentsDefinition, 'AccountBalance'>
