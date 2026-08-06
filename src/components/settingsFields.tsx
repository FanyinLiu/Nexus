// Shared settings drawer action bar. The legacy settings drawer delegates its
// save/cancel area to this component so the action markup and its optional
// status slot stay defined in one place.

import type { ReactNode } from 'react'

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
