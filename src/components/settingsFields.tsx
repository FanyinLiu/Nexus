// Shared form fields for SettingsSections. Replaces ~145 inline handler
// closures with typed wrappers; the `field` prop is keyed against AppSettings
// so renames stay type-checked.
//
// All variants accept the live `draft` + `setDraft` pair from the section
// component (drawer pattern) and write back via the standard
// `setDraft(prev => ({...prev, [field]: nextValue}))` shape.

import { useId } from 'react'
import type {
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  SetStateAction,
} from 'react'
import { parseNumberInput } from './settingsDrawerSupport'
import { displaySecretInputValue } from '../lib/keyVaultBridge'
import type { AppSettings } from '../types'

type FieldShared = {
  label: string
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
}

type SettingsStatusMessageProps = {
  ok?: boolean
  tone?: 'success' | 'error' | 'loading'
  compact?: boolean
  children: ReactNode
}

export function SettingsStatusMessage({
  ok,
  tone,
  compact = false,
  children,
}: SettingsStatusMessageProps) {
  const resolvedTone = tone ?? (ok ? 'success' : 'error')
  const role = resolvedTone === 'error' ? 'alert' : 'status'
  const ariaLive = resolvedTone === 'error' ? 'assertive' : 'polite'

  return (
    <div
      className={[
        'settings-test-result',
        compact ? 'settings-test-result--compact' : '',
        `is-${resolvedTone}`,
      ].filter(Boolean).join(' ')}
      role={role}
      aria-live={ariaLive}
      aria-atomic="true"
    >
      {children}
    </div>
  )
}

type SettingsSegmentedControlOption<TValue extends string> = {
  value: TValue
  label: string
}

type SettingsSegmentedControlProps<TValue extends string> = {
  label: string
  value: TValue
  options: readonly SettingsSegmentedControlOption<TValue>[]
  onChange: (value: TValue) => void
}

export function SettingsSegmentedControl<TValue extends string>({
  label,
  value,
  options,
  onChange,
}: SettingsSegmentedControlProps<TValue>) {
  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, optionIndex: number) {
    let nextIndex = -1

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (optionIndex + 1) % options.length
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (optionIndex - 1 + options.length) % options.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = options.length - 1
        break
      default:
        return
    }

    event.preventDefault()
    const nextOption = options[nextIndex]
    if (!nextOption) return

    onChange(nextOption.value)
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[data-settings-segment-option]')
      .item(nextIndex)
      ?.focus()
  }

  return (
    <div className="settings-segmented-control" role="radiogroup" aria-label={label}>
      {options.map((option, optionIndex) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            className={`settings-segmented-control__option${selected ? ' is-active' : ''}`}
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-settings-segment-option
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, optionIndex)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

type SettingsActionBarProps = {
  cancelLabel: string
  saveLabel: string
  onCancel: () => void
  onSave: () => void
  cancelDisabled?: boolean
  saveDisabled?: boolean
  status?: ReactNode
}

export function SettingsActionBar({
  cancelLabel,
  saveLabel,
  onCancel,
  onSave,
  cancelDisabled = false,
  saveDisabled = false,
  status,
}: SettingsActionBarProps) {
  return (
    <div className="settings-drawer__actions sda settings-action-bar">
      {status ? <div className="settings-action-bar__status">{status}</div> : null}
      <button
        type="button"
        className="ghost-button"
        onClick={onCancel}
        disabled={cancelDisabled}
        aria-label={cancelLabel}
        title={cancelLabel}
      >
        {cancelLabel}
      </button>
      <button
        type="button"
        className="primary-button"
        onClick={onSave}
        disabled={saveDisabled}
        aria-label={saveLabel}
        title={saveLabel}
      >
        {saveLabel}
      </button>
    </div>
  )
}

type SettingsToggleProps = {
  label: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  hideLabel?: boolean
  disabled?: boolean
  className?: string
}

export function SettingsToggle({
  label,
  checked,
  onChange,
  hideLabel = false,
  disabled = false,
  className,
}: SettingsToggleProps) {
  return (
    <label className={['settings-toggle', className].filter(Boolean).join(' ')}>
      <span className={hideLabel ? 'settings-toggle__label settings-toggle__label--hidden' : 'settings-toggle__label'}>
        {label}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  )
}

// ── Toggle (checkbox) ───────────────────────────────────────────────────────

type BooleanField = { [K in keyof AppSettings]: AppSettings[K] extends boolean ? K : never }[keyof AppSettings]

type ToggleFieldProps = FieldShared & {
  field: BooleanField
  disabled?: boolean
}

export function ToggleField({ label, field, disabled, draft, setDraft }: ToggleFieldProps) {
  return (
    <SettingsToggle
      label={label}
      checked={draft[field] as boolean}
      disabled={disabled}
      onChange={(checked) => setDraft((prev) => ({ ...prev, [field]: checked }))}
    />
  )
}

// ── Number ─────────────────────────────────────────────────────────────────

type NumberFieldKey = { [K in keyof AppSettings]: AppSettings[K] extends number ? K : never }[keyof AppSettings]

type NumberFieldProps = FieldShared & {
  field: NumberFieldKey
  min: number
  max: number
  step: number
  /** Optional clamp applied after parse (e.g. matrix-style validation). */
  clamp?: (value: number) => number
}

export function NumberField({ label, field, min, max, step, clamp, draft, setDraft }: NumberFieldProps) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft[field] as number}
        onChange={(e) => setDraft((prev) => {
          const parsed = parseNumberInput(e.target.value, prev[field] as number)
          return { ...prev, [field]: clamp ? clamp(parsed) : parsed }
        })}
      />
    </label>
  )
}

// ── Text (single-line input) ────────────────────────────────────────────────

type StringFieldKey = { [K in keyof AppSettings]: AppSettings[K] extends string ? K : never }[keyof AppSettings]

type TextFieldProps = FieldShared & {
  field: StringFieldKey
  placeholder?: string
  type?: 'text' | 'password' | 'email' | 'url'
  id?: string
  description?: string
  validation?: string
  status?: string
  autoComplete?: string
  updateDraft?: (prev: AppSettings, value: string) => AppSettings
}

function getSettingsFieldId(field: string, id: string) {
  return `settings-field-${field.replace(/[^a-z0-9_-]/gi, '-').toLowerCase()}-${id.replace(/:/g, '')}`
}

export function TextField({
  label,
  field,
  placeholder,
  type = 'text',
  id,
  description,
  validation,
  status,
  autoComplete,
  updateDraft,
  draft,
  setDraft,
}: TextFieldProps) {
  const reactId = useId()
  const inputId = id ?? getSettingsFieldId(String(field), reactId)
  const descriptionId = description ? `${inputId}-description` : undefined
  const validationId = validation ? `${inputId}-validation` : undefined
  const describedBy = [descriptionId, validationId].filter(Boolean).join(' ') || undefined
  const rawValue = draft[field] as string
  const inputValue = type === 'password'
    ? displaySecretInputValue(rawValue)
    : rawValue

  return (
    <div className="settings-form-row">
      <label className="settings-form-row__label" htmlFor={inputId}>
        {label}
      </label>
      {description ? (
        <p className="settings-form-row__description" id={descriptionId}>
          {description}
        </p>
      ) : null}
      <input
        id={inputId}
        type={type}
        value={inputValue}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-describedby={describedBy}
        aria-invalid={validation ? true : undefined}
        onChange={(e) => setDraft((prev) => (
          updateDraft ? updateDraft(prev, e.target.value) : { ...prev, [field]: e.target.value }
        ))}
      />
      {validation ? (
        <p className="settings-form-row__validation" id={validationId}>
          {validation}
        </p>
      ) : null}
      {status ? (
        <p className="settings-form-row__status">
          {status}
        </p>
      ) : null}
    </div>
  )
}
