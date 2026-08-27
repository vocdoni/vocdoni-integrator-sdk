import { FormEvent, HTMLAttributes } from 'react'
import { HR } from '../shared/HR'
import { linkifyIpfs } from '../shared/ipfs'
import { ComponentsDefinition } from './types'

const ActionButton = ({ label, loading, ...props }: any) => (
  <button {...props}>
    {loading ? '...' : null}
    {label}
  </button>
)

const TrustedHtml = ({ html, ...rest }: HTMLAttributes<HTMLDivElement> & { html?: string }) => {
  if (!html) return null
  return <div {...rest} dangerouslySetInnerHTML={{ __html: html }} />
}

const getTitle = (title: string | Record<string, string> | undefined): string => {
  if (!title) return ''
  if (typeof title === 'string') return title
  return title.default ?? Object.values(title)[0] ?? ''
}

export const defaultComponents: ComponentsDefinition = {
  HR,
  ElectionTitle: ({ title, ...props }) => <h1 {...props}>{title}</h1>,
  ElectionDescription: ({ description, ...props }) => (
    <div {...props}>
      <TrustedHtml html={description} />
    </div>
  ),
  ElectionSchedule: ({ text, ...props }) => <p {...props}>{text}</p>,
  ElectionStatusBadge: ({ label, tone, ...props }) => (
    <span {...props} data-tone={tone}>
      {label}
    </span>
  ),
  ElectionHeader: ({ src, alt, ...props }) => (src ? <img {...props} alt={alt} src={linkifyIpfs(src)} /> : null),
  ElectionQuestions: ({ form, ...props }) => <div {...props}>{form}</div>,
  ElectionQuestion: ({
    title,
    description,
    fields,
    tip,
    hasExtendedChoices,
    selectionMode,
    layout,
    invalid,
    ...props
  }) => (
    <section
      {...props}
      data-has-extended-choices={hasExtendedChoices}
      data-selection-mode={selectionMode}
      data-layout={layout}
      data-invalid={invalid ? 'true' : undefined}
    >
      <label>{title}</label>
      <TrustedHtml html={description} />
      {fields}
      {tip}
    </section>
  ),
  QuestionChoice: ({
    choice,
    value,
    label,
    description,
    image,
    compact,
    // Slot prop for overrides; destructured so it does not reach the DOM via {...props}.
    hasImage: _hasImage,
    canOpenImageModal,
    dataAttrs,
    presentation,
    selectionMode,
    selected,
    disabled,
    controlType,
    onSelect,
    ...props
  }) => {
    const id = `choice-${choice.value}`
    const imageSrc = image?.thumbnail ?? image?.default

    return (
      <label
        {...props}
        data-presentation={presentation}
        data-selection-mode={selectionMode}
        data-choice-card={dataAttrs?.['data-choice-card']}
        data-layout={dataAttrs?.['data-layout']}
      >
        <input
          id={id}
          value={value}
          type={controlType}
          checked={selected}
          disabled={disabled}
          onChange={(event) => onSelect(event.target.checked)}
          data-choice-control={dataAttrs?.['data-choice-control']}
        />
        {imageSrc ? (
          <img
            src={linkifyIpfs(imageSrc)}
            alt={label}
            data-choice-media={dataAttrs?.['data-choice-media']}
            data-can-open-modal={canOpenImageModal ? 'true' : undefined}
          />
        ) : null}
        <span data-choice-body={dataAttrs?.['data-choice-body']} data-compact={compact ? '' : undefined}>
          {label}
        </span>
        <TrustedHtml html={description} />
      </label>
    )
  },
  // A `<select>` per option: the plainest ordering control, keyboard- and
  // screen-reader-navigable with no drag-and-drop dependency. Taken positions stay
  // selectable so a swap is one move.
  QuestionRankChoice: ({
    choice,
    value,
    label,
    description,
    image,
    compact,
    // See the note on QuestionChoice above: unused here, but it must not reach the DOM.
    hasImage: _hasImage,
    canOpenImageModal,
    dataAttrs,
    presentation,
    position,
    options,
    disabled,
    onRank,
    ...props
  }) => {
    const imageSrc = image?.thumbnail ?? image?.default

    return (
      <label
        {...props}
        data-presentation={presentation}
        data-selection-mode='ranked'
        data-choice-value={value}
        data-choice-card={dataAttrs?.['data-choice-card']}
        data-layout={dataAttrs?.['data-layout']}
      >
        {imageSrc ? (
          <img
            src={linkifyIpfs(imageSrc)}
            alt={label}
            data-choice-media={dataAttrs?.['data-choice-media']}
            data-can-open-modal={canOpenImageModal ? 'true' : undefined}
          />
        ) : null}
        <span data-choice-body={dataAttrs?.['data-choice-body']} data-compact={compact ? '' : undefined}>
          {label}
        </span>
        <TrustedHtml html={description} />
        <select
          id={`rank-${choice.value}`}
          value={position ?? ''}
          disabled={disabled}
          data-choice-control={dataAttrs?.['data-choice-control']}
          onChange={(event) => onRank(event.target.value === '' ? null : Number(event.target.value))}
        >
          <option value=''>—</option>
          {options.map((option) => (
            <option key={option.position} value={option.position} data-taken={option.taken ? '' : undefined}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    )
  },
  QuestionsTypeBadge: ({ title, tooltip, ...props }) => (
    <div {...props} title={tooltip}>
      {title}
    </div>
  ),
  QuestionTip: ({ text, ...props }) => <div {...props}>{text}</div>,
  QuestionsEmpty: ({ text, ...props }) => <div {...props}>{text}</div>,
  QuestionsError: ({ error, variant, ...props }) => (
    <div {...props} data-variant={variant}>
      {error}
    </div>
  ),
  QuestionsConfirmation: ({ election, answersView, onConfirm, onCancel, ...props }) => (
    <div {...props}>
      <h3>Confirm</h3>
      <p>{getTitle(election.title)}</p>
      {answersView.map((item, idx) => (
        <div key={idx}>
          <strong>{item.question}</strong>
          <div>{item.answers.join(', ')}</div>
        </div>
      ))}
      <button onClick={onCancel}>Cancel</button>
      <button onClick={onConfirm}>Confirm</button>
    </div>
  ),
  Voted: ({ title, description, votes, ...props }) => (
    <div {...props}>
      <strong>{title}</strong>
      {votes.length > 0 ? (
        votes.map((vote) => <p key={vote.questionId}>{vote.description}</p>)
      ) : (
        <p>{description}</p>
      )}
    </div>
  ),
  VoteButton: ({ label, loading, ...props }) => <button {...props}>{loading ? '...' : label}</button>,
  VoteWeight: ({ label, weight, ...props }) => (
    <div {...props}>
      {label}
      <span>{weight}</span>
    </div>
  ),
  ElectionResults: ({ secretText, questions, ...props }) => (
    <div {...props}>
      {secretText ? <p>{secretText}</p> : null}
      {questions?.map((question) => (
        <section key={question.title}>
          <h3>{question.title}</h3>
          {question.choices.map((choice) => (
            <div key={choice.title}>
              <strong>{choice.title}</strong> {choice.votes} ({choice.percent})
              <TrustedHtml html={choice.description} />
              {choice.image ? <img src={linkifyIpfs(choice.image)} alt={choice.title} /> : null}
            </div>
          ))}
        </section>
      ))}
    </div>
  ),
  SpreadsheetAccess: ({
    connected,
    loading,
    formError,
    title,
    open,
    onOpen,
    onClose,
    onLogout,
    onSubmit,
    fields,
    anonymousField,
    extraFields,
    ...props
  }) => {
    if (connected) {
      return (
        <button onClick={onLogout} disabled={loading}>
          Logout
        </button>
      )
    }

    if (!open) {
      return (
        <button onClick={onOpen} disabled={loading}>
          Identify
        </button>
      )
    }

    return (
      <div {...props}>
        <h3>{title}</h3>
        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            onSubmit(event)
          }}
        >
          {fields.map((field) => (
            <label key={field.id}>
              {field.label}
              <input {...field.inputProps} {...field.inputAttrs} />
              {field.error ? <small>{field.error}</small> : null}
              {field.description ? <small>{field.description}</small> : null}
            </label>
          ))}
          {anonymousField ? (
            <label>
              {anonymousField.label}
              <input {...anonymousField.inputProps} {...anonymousField.inputAttrs} />
              {anonymousField.error ? <small>{anonymousField.error}</small> : null}
              {anonymousField.description ? <small>{anonymousField.description}</small> : null}
            </label>
          ) : null}
          {formError ? <small>{formError}</small> : null}
          {extraFields}
          <button type='button' onClick={onClose}>
            Close
          </button>
          <button type='submit' disabled={loading}>
            Identify
          </button>
        </form>
      </div>
    )
  },
  ElectionActions: ({ actions, ...props }) => <div {...props}>{actions}</div>,
  ActionContinue: ActionButton,
  ActionPause: ActionButton,
  ActionEnd: ActionButton,
  ActionCancel: ActionButton,
  ConfirmActionModal: ({ title, description, confirm, cancel, onConfirm, onCancel, ...props }) => (
    <div {...props}>
      <h3>{title}</h3>
      <p>{description}</p>
      <button onClick={onCancel}>{cancel}</button>
      <button onClick={onConfirm}>{confirm}</button>
    </div>
  ),
  ConfirmShell: ({ isOpen, onClose, content, ...props }) => {
    if (!isOpen) return null

    return (
      <div className='vocdoni-confirm-modal-overlay' role='presentation' onClick={onClose} {...props}>
        <div
          className='vocdoni-confirm-modal-content'
          role='dialog'
          aria-modal='true'
          onClick={(event) => event.stopPropagation()}
        >
          {content}
        </div>
      </div>
    )
  },
  AccountBalance: ({ label, tone, ...props }) => (
    <span {...props} data-tone={tone}>
      {label}
    </span>
  ),
  PaginationContainer: ({ items, ...props }) => <div {...props}>{items}</div>,
  PaginationButton: ({ label, href, isActive, disabled, onClick, ...props }) =>
    href ? (
      <a {...props} href={href} data-active={isActive ? '' : undefined}>
        {label}
      </a>
    ) : (
      <button {...props} onClick={onClick} disabled={disabled} data-active={isActive ? '' : undefined}>
        {label}
      </button>
    ),
  PaginationEllipsisButton: ({ className, isInput, onToggle, onSubmitPage, placeholder, buttonProps, inputProps }) => {
    if (isInput) {
      return (
        <input
          className={className}
          {...inputProps}
          placeholder={placeholder}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !(event.currentTarget instanceof HTMLInputElement)) return
            const pageNumber = Number(event.currentTarget.value)
            onSubmitPage(pageNumber)
          }}
          onBlur={onToggle}
          autoFocus
        />
      )
    }

    return (
      <button
        className={className}
        {...buttonProps}
        onClick={(event) => {
          event.preventDefault()
          onToggle()
        }}
      >
        ...
      </button>
    )
  },
  PaginationSummary: ({ text, ...props }) => <p {...props}>{text}</p>,
  OrganizationName: ({ name, ...props }) => <h1 {...props}>{name}</h1>,
  OrganizationDescription: ({ description, ...props }) => (
    <div {...props}>
      <TrustedHtml html={description} />
    </div>
  ),
  OrganizationAvatar: ({ src, alt, ...props }) => (src ? <img {...props} src={linkifyIpfs(src)} alt={alt} /> : null),
}
