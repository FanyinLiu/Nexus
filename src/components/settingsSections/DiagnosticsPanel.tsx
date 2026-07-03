import { memo, useCallback, useState } from 'react'
import { clearLogs, exportLogs, getLogEntries } from '../../lib/logger'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { UiLanguage } from '../../types'

type DiagnosticsPanelProps = {
  uiLanguage: UiLanguage
}

/**
 * Minimal diagnostics panel: exports the in-memory ring buffer as a
 * JSONL file so users can attach it to bug reports, and offers a clear
 * button. Designed to sit below the updater panel inside the
 * Console / debug settings section.
 *
 * Localized because this panel is exposed inside the same settings surface
 * as updater and cost diagnostics.
 */
export const DiagnosticsPanel = memo(function DiagnosticsPanel({ uiLanguage }: DiagnosticsPanelProps) {
  const [feedback, setFeedback] = useState<string | null>(null)
  const ti = useCallback((
    key: Parameters<typeof pickTranslatedUiText>[1],
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(uiLanguage, key, params), [uiLanguage])

  const showFeedback = useCallback((text: string) => {
    setFeedback(text)
    window.setTimeout(() => setFeedback(null), 3_000)
  }, [])

  const handleExport = useCallback(() => {
    const jsonl = exportLogs()
    if (!jsonl) {
      showFeedback(ti('settings.console.diagnostics.no_logs'))
      return
    }

    const blob = new Blob([jsonl], { type: 'application/x-ndjson' })
    const url = URL.createObjectURL(blob)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `nexus-logs-${stamp}.jsonl`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)

    showFeedback(ti('settings.console.diagnostics.exported', { count: getLogEntries().length }))
  }, [showFeedback, ti])

  const handleCopy = useCallback(async () => {
    const jsonl = exportLogs()
    if (!jsonl) {
      showFeedback(ti('settings.console.diagnostics.no_logs'))
      return
    }

    try {
      await navigator.clipboard.writeText(jsonl)
      showFeedback(ti('settings.console.diagnostics.copied', { count: getLogEntries().length }))
    } catch (err) {
      showFeedback(ti('settings.console.diagnostics.copy_failed', {
        message: getRedactedLogErrorMessage(err),
      }))
    }
  }, [showFeedback, ti])

  const handleClear = useCallback(() => {
    clearLogs()
    showFeedback(ti('settings.console.diagnostics.cleared'))
  }, [showFeedback, ti])

  return (
    <section className="settings-diagnostics-panel">
      <header className="settings-diagnostics-panel__header">
        <h4>{ti('settings.console.diagnostics.title')}</h4>
        <p>{ti('settings.console.diagnostics.description')}</p>
      </header>
      <div className="settings-diagnostics-panel__actions">
        <button type="button" className="primary-button" onClick={handleExport}>
          {ti('settings.console.diagnostics.download_logs')}
        </button>
        <button type="button" className="ghost-button" onClick={handleCopy}>
          {ti('settings.console.diagnostics.copy_logs')}
        </button>
        <button type="button" className="ghost-button" onClick={handleClear}>
          {ti('settings.console.diagnostics.clear_logs')}
        </button>
      </div>
      {feedback ? (
        <p className="settings-diagnostics-panel__feedback">{feedback}</p>
      ) : null}
    </section>
  )
})
