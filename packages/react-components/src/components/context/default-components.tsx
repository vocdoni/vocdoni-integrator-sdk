import { Fragment, HTMLAttributes, useEffect, useId, useRef } from 'react'
import { HR } from '../shared/HR'
import { linkifyIpfs } from '../shared/ipfs'
import { ComponentsDefinition, CspAuthField, CspAuthModalSlotProps } from './types'

const ActionButton = ({ label, loading, ...props }: any) => (
  <button {...props}>
    {loading ? '...' : null}
    {label}
  </button>
)

// Metadata is untrusted (any account can write it), so it renders as text only.
// A slot that wants Markdown or HTML must override it and sanitize the output.
const PlainText = ({ text, ...rest }: HTMLAttributes<HTMLDivElement> & { text?: string }) => {
  const value = text?.trim()
  if (!value) return null
  const lines = value.split(/\r\n|\r|\n/)
  return (
    <div {...rest}>
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 ? <br /> : null}
          {line}
        </Fragment>
      ))}
    </div>
  )
}

const getTitle = (title: string | Record<string, string> | undefined): string => {
  if (!title) return ''
  if (typeof title === 'string') return title
  return title.default ?? Object.values(title)[0] ?? ''
}

// One text input, with its helper and error linked to it so screen readers announce both.
const CspAuthFieldInput = ({ field }: { field: CspAuthField }) => {
  const id = useId()
  const helperId = field.helper ? `${id}-helper` : undefined
  const errorId = field.error ? `${id}-error` : undefined
  return (
    <div>
      <label>
        {field.label}
        <input
          {...field.inputProps}
          type={field.type}
          required={field.required}
          aria-invalid={field.error ? true : undefined}
          aria-describedby={[helperId, errorId].filter(Boolean).join(' ') || undefined}
        />
      </label>
      {field.helper ? <small id={helperId}>{field.helper}</small> : null}
      {field.error ? <small id={errorId} role='alert'>{field.error}</small> : null}
    </div>
  )
}

const CspAuthModalShell = ({ isOpen, onClose, title, closeLabel, content, ...props }: CspAuthModalSlotProps) => {
  const dialogRef = useRef<HTMLDivElement>(null)

  // Focus moves into the dialog on open and returns to the element that had it on close.
  useEffect(() => {
    if (!isOpen) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    return () => previous?.focus()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className='vocdoni-csp-auth-modal-overlay' role='presentation' onClick={onClose} {...props}>
      <div
        ref={dialogRef}
        className='vocdoni-csp-auth-modal-content'
        role='dialog'
        aria-modal='true'
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          <button type='button' onClick={onClose}>
            {closeLabel}
          </button>
        </header>
        {content}
      </div>
    </div>
  )
}

export const defaultComponents: ComponentsDefinition = {
  HR,
  ElectionTitle: ({ title, ...props }) => <h1 {...props}>{title}</h1>,
  ElectionDescription: ({ description, ...props }) => (
    <div {...props}>
      <PlainText text={description} />
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
      <PlainText text={description} />
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
        <PlainText text={description} />
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
        <PlainText text={description} />
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
  VoteButton: ({ label, loading, tooltip, ...props }) => (
    <button {...props} title={tooltip ?? props.title}>
      {loading ? '...' : label}
    </button>
  ),
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
              <strong>{choice.title}</strong>
              {/* Empty for a question whose results could not be decoded. */}
              {choice.votes ? ` ${choice.votes} (${choice.percent})` : null}
              <PlainText text={choice.description} />
              {choice.image ? <img src={linkifyIpfs(choice.image)} alt={choice.title} /> : null}
            </div>
          ))}
        </section>
      ))}
    </div>
  ),
  CspAuthTrigger: ({ label, onClick, loading, ...props }) => (
    <button {...props} type='button' onClick={onClick} aria-busy={loading || undefined}>
      {label}
    </button>
  ),
  CspAuthLogout: ({ label, onClick, ...props }) => (
    <button {...props} type='button' onClick={onClick}>
      {label}
    </button>
  ),
  CspAuthModal: CspAuthModalShell,
  CspAuthIdentifyForm: ({ fields, terms, termsField, error, loading, submitLabel, info, onSubmit, ...props }) => {
    const termsId = useId()
    const termsErrorId = termsField?.error ? `${termsId}-error` : undefined

    return (
      <form {...props} noValidate onSubmit={onSubmit}>
        {fields.map((field) => (
          <CspAuthFieldInput key={field.name} field={field} />
        ))}
        {termsField ? (
          <div>
            <label>
              <input
                type='checkbox'
                {...termsField.inputProps}
                aria-invalid={termsField.error ? true : undefined}
                aria-describedby={termsErrorId}
              />
              {terms}
            </label>
            {termsField.error ? <small id={termsErrorId} role='alert'>{termsField.error}</small> : null}
          </div>
        ) : (
          terms
        )}
        {error ? <p role='alert'>{error}</p> : null}
        <button type='submit' disabled={loading} aria-busy={loading || undefined}>
          {submitLabel}
        </button>
        {info ? <p>{info}</p> : null}
      </form>
    )
  },
  CspAuthCodeForm: ({
    title,
    helper,
    code,
    length,
    onCodeChange,
    error,
    notice,
    loading,
    submitLabel,
    onSubmit,
    resendLabel,
    onResend,
    resending,
    startOverLabel,
    onStartOver,
    actionsDisabled,
    footer,
    ...props
  }) => {
    const id = useId()
    const helperId = `${id}-helper`

    return (
      <form {...props} noValidate onSubmit={onSubmit}>
        <label>
          {title}
          <input
            inputMode='numeric'
            autoComplete='one-time-code'
            maxLength={length}
            value={code}
            aria-describedby={helperId}
            onChange={(event) => onCodeChange(event.target.value)}
          />
        </label>
        <p id={helperId}>{helper}</p>
        {notice ? <p role='status'>{notice}</p> : null}
        {error ? <p role='alert'>{error}</p> : null}
        <button type='submit' disabled={loading} aria-busy={loading || undefined}>
          {submitLabel}
        </button>
        <button
          type='button'
          onClick={onResend}
          disabled={actionsDisabled || resending}
          aria-busy={resending || undefined}
        >
          {resendLabel}
        </button>
        <button type='button' onClick={onStartOver} disabled={actionsDisabled}>
          {startOverLabel}
        </button>
        {footer ? <p>{footer}</p> : null}
      </form>
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
      <PlainText text={description} />
    </div>
  ),
  OrganizationAvatar: ({ src, alt, ...props }) => (src ? <img {...props} src={linkifyIpfs(src)} alt={alt} /> : null),
}
