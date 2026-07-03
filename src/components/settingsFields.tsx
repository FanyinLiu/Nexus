// Shared form fields for SettingsSections. Replaces ~145 inline handler
// closures with typed wrappers; the `field` prop is keyed against AppSettings
// so renames stay type-checked.
//
// All variants accept the live `draft` + `setDraft` pair from the section
// component (drawer pattern) and write back via the standard
// `setDraft(prev => ({...prev, [field]: nextValue}))` shape.

import { useId } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { parseNumberInput } from './settingsDrawerSupport'
import { displaySecretInputValue } from '../lib/keyVaultBridge'
import type { AppSettings } from '../types'

type FieldShared = {
  label: string
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
}

// ── Toggle (checkbox) ───────────────────────────────────────────────────────

type BooleanField = { [K in keyof AppSettings]: AppSettings[K] extends boolean ? K : never }[keyof AppSettings]

type ToggleFieldProps = FieldShared & {
  field: BooleanField
  disabled?: boolean
}

export function ToggleField({ label, field, disabled, draft, setDraft }: ToggleFieldProps) {
  return (
    <label className="settings-toggle">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={draft[field] as boolean}
        disabled={disabled}
        onChange={(e) => setDraft((prev) => ({ ...prev, [field]: e.target.checked }))}
      />
    </label>
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
