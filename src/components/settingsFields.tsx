// Shared form fields for SettingsSections. Replaces ~145 inline handler
// closures with typed wrappers; the `field` prop is keyed against AppSettings
// so renames stay type-checked.
//
// All variants accept the live `draft` + `setDraft` pair from the section
// component (drawer pattern) and write back via the standard
// `setDraft(prev => ({...prev, [field]: nextValue}))` shape.

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
}

export function TextField({ label, field, placeholder, type = 'text', draft, setDraft }: TextFieldProps) {
  const rawValue = draft[field] as string
  const inputValue = type === 'password'
    ? displaySecretInputValue(rawValue)
    : rawValue

  return (
    <label>
      <span>{label}</span>
      <input
        type={type}
        value={inputValue}
        placeholder={placeholder}
        onChange={(e) => setDraft((prev) => ({ ...prev, [field]: e.target.value }))}
      />
    </label>
  )
}

// ── Textarea (multi-line input) ─────────────────────────────────────────────

type TextareaFieldProps = FieldShared & {
  field: StringFieldKey
  rows?: number
  placeholder?: string
}

export function TextareaField({ label, field, rows = 4, placeholder, draft, setDraft }: TextareaFieldProps) {
  return (
    <label>
      <span>{label}</span>
      <textarea
        rows={rows}
        value={draft[field] as string}
        placeholder={placeholder}
        onChange={(e) => setDraft((prev) => ({ ...prev, [field]: e.target.value }))}
      />
    </label>
  )
}
