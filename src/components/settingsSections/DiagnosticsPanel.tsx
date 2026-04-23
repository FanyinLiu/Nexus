import { memo, useCallback, useState } from 'react'
import { clearLogs, exportLogs, getLogEntries } from '../../lib/logger'

/**
 * Minimal diagnostics panel: exports the in-memory ring buffer as a
 * JSONL file so users can attach it to bug reports, and offers a clear
 * button. Designed to sit below the updater panel inside the
 * Console / debug settings section.
 *
 * No localisation wrapper — this surface is developer-facing (matches
 * the Updater panel's English-only "check for updates" text in the
 * other locales). If full i18n is needed later, mirror UpdaterPanel.
 */
export const DiagnosticsPanel = memo(function DiagnosticsPanel() {
  const [feedback, setFeedback] = useState<string | null>(null)

  const showFeedback = useCallback((text: string) => {
    setFeedback(text)
    window.setTimeout(() => setFeedback(null), 3_000)
  }, [])

  const handleExport = useCallback(() => {
    const jsonl = exportLogs()
    if (!jsonl) {
      showFeedback('No log entries captured yet.')
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

    showFeedback(`Exported ${getLogEntries().length} log entries.`)
  }, [showFeedback])

  const handleCopy = useCallback(async () => {
    const jsonl = exportLogs()
    if (!jsonl) {
      showFeedback('No log entries captured yet.')
      return
    }

    try {
      await navigator.clipboard.writeText(jsonl)
      showFeedback(`Copied ${getLogEntries().length} log entries.`)
    } catch (err) {
      showFeedback(`Copy failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [showFeedback])

  const handleClear = useCallback(() => {
    clearLogs()
    showFeedback('Log ring buffer cleared.')
  }, [showFeedback])

  return (
    <section className="settings-diagnostics-panel">
      <header className="settings-diagnostics-panel__header">
        <h4>Diagnostics</h4>
        <p>
          Export the in-memory log ring (most recent ~500 entries) for
          bug reports.
        </p>
      </header>
      <div className="settings-diagnostics-panel__actions">
        <button type="button" className="primary-button" onClick={handleExport}>
          Download logs (.jsonl)
        </button>
        <button type="button" className="ghost-button" onClick={handleCopy}>
          Copy to clipboard
        </button>
        <button type="button" className="ghost-button" onClick={handleClear}>
          Clear ring
        </button>
      </div>
      {feedback ? (
        <p className="settings-diagnostics-panel__feedback">{feedback}</p>
      ) : null}
    </section>
  )
})
