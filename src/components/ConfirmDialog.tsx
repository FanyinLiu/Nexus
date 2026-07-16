import { useEffect, useId, useRef } from 'react'
import { useTranslation } from '../i18n/useTranslation.ts'
import { useModalFocusTrap } from '../hooks/useModalFocusTrap.ts'
import type { ConfirmOptions } from './useConfirm.ts'

type ConfirmDialogProps = {
  options: ConfirmOptions | null
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ options, onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useTranslation()
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const messageId = useId()
  useModalFocusTrap(dialogRef, options !== null)

  useEffect(() => {
    if (!options) return
    // Focus the safe (cancel) action and let Escape back out.
    cancelButtonRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [options, onCancel])

  if (!options) return null

  const confirmLabel = options.confirmLabel ?? t('common.ok')
  const cancelLabel = options.cancelLabel ?? t('common.cancel')
  const danger = options.tone !== 'default'

  return (
    <div
      className="confirm-dialog-backdrop"
      onClick={(event) => {
        // Stop the click from reaching the settings backdrop (which would
        // dismiss the whole drawer); a backdrop click just cancels.
        event.stopPropagation()
        onCancel()
      }}
    >
      <div
        ref={dialogRef}
        className="confirm-dialog-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={options.title ? titleId : messageId}
        aria-describedby={options.title ? messageId : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        {options.title ? <h2 id={titleId} className="confirm-dialog-card__title">{options.title}</h2> : null}
        <p id={messageId} className="confirm-dialog-card__message">{options.message}</p>
        <div className="confirm-dialog-card__actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="ghost-button"
            data-focus-default="cancel"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'confirm-dialog-card__confirm is-danger' : 'confirm-dialog-card__confirm'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
