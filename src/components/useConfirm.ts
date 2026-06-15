import { useCallback, useRef, useState } from 'react'

export type ConfirmOptions = {
  message: string
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'default'
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

/**
 * Promise-based replacement for window.confirm(). `confirm(options)` opens the
 * styled dialog and resolves to true/false once the user picks. The resolver is
 * held in a ref so the confirm/cancel handlers stay referentially stable.
 */
export function useConfirm() {
  const [confirmOptions, setConfirmOptions] = useState<ConfirmOptions | null>(null)
  const resolverRef = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        resolverRef.current = resolve
        setConfirmOptions(options)
      }),
    [],
  )

  const settle = useCallback((value: boolean) => {
    resolverRef.current?.(value)
    resolverRef.current = null
    setConfirmOptions(null)
  }, [])

  return {
    confirm,
    confirmOptions,
    handleConfirm: useCallback(() => settle(true), [settle]),
    handleCancel: useCallback(() => settle(false), [settle]),
  }
}
