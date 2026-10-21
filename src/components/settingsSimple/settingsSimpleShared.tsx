/**
 * Shared rows for the five simplified settings pages.
 * Badge color comes from theme tokens, never a fixed hex.
 */

import type { ReactNode } from 'react'
import { renderSettingsCardIcon, type SettingsCardIconKey } from '../settingsDrawerIcons.tsx'

export type SimpleTone = 'accent' | 'success' | 'warning'

export function SimpleRow({
  icon,
  tone = 'accent',
  title,
  hint,
  children,
}: {
  icon: SettingsCardIconKey
  tone?: SimpleTone
  title: string
  hint?: string
  children?: ReactNode
}) {
  return (
    <div className="settings-v3-row">
      <span className="settings-v3-row__icon" data-tone={tone === 'accent' ? undefined : tone} aria-hidden="true">
        {renderSettingsCardIcon(icon)}
      </span>
      <div className="settings-v3-row__copy">
        <strong>{title}</strong>
        {hint ? <span>{hint}</span> : null}
      </div>
      {children ? <div className="settings-v3-row__control">{children}</div> : null}
    </div>
  )
}

export function SimpleChoices<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="settings-v3-choice-row" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function SimpleAdvanced({
  title,
  hint,
  open,
  onOpenChange,
  children,
}: {
  title: string
  hint: string
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <details
      className="settings-v3-disclosure"
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
    >
      <summary>
        <span>
          <strong>{title}</strong>
          <small>{hint}</small>
        </span>
      </summary>
      {open ? <div className="settings-v3-disclosure__body">{children}</div> : null}
    </details>
  )
}
