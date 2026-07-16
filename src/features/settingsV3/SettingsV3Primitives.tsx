import type { ReactNode } from 'react'
import { PetControlIcon, type PetControlIconName } from '../../components/PetControlIcon'
import './settings-v3.css'

export function SettingsV3Page({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`settings-v3-page ${className}`.trim()}>{children}</div>
}

export function SettingsV3Section({
  title,
  description,
  children,
  hideHeader = false,
  fill = false,
}: {
  title: string
  description?: string
  children: ReactNode
  hideHeader?: boolean
  fill?: boolean
}) {
  return (
    <section className={`settings-v3-section ${fill ? 'settings-v3-section--fill' : ''} ${hideHeader ? 'settings-v3-section--header-hidden' : ''}`.trim()}>
      <header className={hideHeader ? 'settings-v3-sr-only' : 'settings-v3-section__header'}>
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </header>
      <div className="settings-v3-section__body">{children}</div>
    </section>
  )
}

export function SettingsV3Row({
  icon,
  label,
  hint,
  meta,
  children,
  disabled = false,
}: {
  icon?: PetControlIconName
  label: string
  hint?: string
  meta?: ReactNode
  children?: ReactNode
  disabled?: boolean
}) {
  return (
    <div className="settings-v3-row" data-disabled={disabled ? 'true' : undefined}>
      {icon ? <span className="settings-v3-row__icon" aria-hidden="true"><PetControlIcon name={icon} /></span> : null}
      <div className="settings-v3-row__copy">
        <strong>{label}</strong>
        {hint ? <span>{hint}</span> : null}
      </div>
      {meta ? <span className="settings-v3-row__meta">{meta}</span> : null}
      {children ? <div className="settings-v3-row__control">{children}</div> : null}
    </div>
  )
}

export function SettingsV3Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="settings-v3-switch">
      <span className="settings-v3-sr-only">{label}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="settings-v3-switch__track" aria-hidden="true"><span /></span>
    </label>
  )
}

export function SettingsV3Notice({
  tone = 'info',
  title,
  children,
  announce = false,
}: {
  tone?: 'info' | 'warning' | 'error' | 'success'
  title: string
  children?: ReactNode
  announce?: boolean
}) {
  return (
    <div
      className={`settings-v3-notice is-${tone}`}
      role={tone === 'error' ? 'alert' : announce ? 'status' : undefined}
      aria-atomic={tone === 'error' || announce ? 'true' : undefined}
    >
      <PetControlIcon name={tone === 'error' ? 'close' : 'tuning'} aria-hidden="true" />
      <div><strong>{title}</strong>{children ? <span>{children}</span> : null}</div>
    </div>
  )
}

export function SettingsV3Toolbar({ children }: { children: ReactNode }) {
  return <div className="settings-v3-toolbar">{children}</div>
}

export type SettingsV3ConnectionEvidenceValue = {
  tone: 'info' | 'success' | 'warning' | 'error'
  message: string
  checkedAt?: string
  recommendation?: string
  action?: { label: string; run: () => void }
}

export function SettingsV3ConnectionEvidence({ evidence }: { evidence: SettingsV3ConnectionEvidenceValue | null }) {
  if (!evidence) return null
  return (
    <div className="settings-v3-connection-evidence">
      <SettingsV3Notice tone={evidence.tone} title={evidence.message} announce>
        {[evidence.checkedAt, evidence.recommendation].filter(Boolean).join(' · ')}
      </SettingsV3Notice>
      {evidence.action ? <SettingsV3Toolbar><button type="button" onClick={evidence.action.run}>{evidence.action.label}</button></SettingsV3Toolbar> : null}
    </div>
  )
}

export function SettingsV3Empty({ title, description }: { title: string; description?: string }) {
  return <div className="settings-v3-empty"><strong>{title}</strong>{description ? <span>{description}</span> : null}</div>
}

export function SettingsV3Disclosure({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <details className="settings-v3-disclosure">
      <summary><span><strong>{title}</strong>{description ? <small>{description}</small> : null}</span><PetControlIcon name="chevron-down" aria-hidden="true" /></summary>
      <div className="settings-v3-disclosure__body">{children}</div>
    </details>
  )
}

export function SettingsV3Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return <label className="settings-v3-field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>
}
