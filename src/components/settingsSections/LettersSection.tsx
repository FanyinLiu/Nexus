import { memo, useEffect, useState } from 'react'
import { loadLetters, type SavedLetter } from '../../features/letter/letterStore'
import { saveTextFileWithFallback } from '../../lib/textFiles'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { UiLanguage } from '../../types'

/**
 * Lazy-load the export renderer on click — keeps the HTML template (and
 * its inlined font / CSS strings) out of the main bundle for users who
 * never export.
 */
async function exportLetterToFile(letter: SavedLetter): Promise<void> {
  try {
    const { buildLetterFilename, renderLetterHtml } = await import(
      '../../features/letter/letterExport'
    )
    const html = renderLetterHtml(letter)
    const filename = buildLetterFilename(letter)
    await saveTextFileWithFallback({
      title: 'Save letter',
      content: html,
      defaultFileName: filename,
    })
  } catch (err) {
    // Wraps both chunk-load failure (offline / cache poisoning) and the
    // save-dialog rejection. Either way, button click should not become
    // an unhandled promise.
    console.warn('[letter-export] failed:', err)
  }
}

type LettersSectionProps = {
  active: boolean
  uiLanguage: UiLanguage
}

function formatLetterDate(letterDate: string, uiLanguage: UiLanguage): string {
  const t = Date.parse(letterDate)
  if (!Number.isFinite(t)) return letterDate
  const localeTag = uiLanguage === 'en-US' ? 'en-US' : uiLanguage
  return new Intl.DateTimeFormat(localeTag, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    weekday: 'long',
  }).format(new Date(t))
}

function LetterCard({
  letter,
  uiLanguage,
  expanded,
  onToggle,
}: {
  letter: SavedLetter
  uiLanguage: UiLanguage
  expanded: boolean
  onToggle: () => void
}) {
  const ti = (
    key: Parameters<typeof pickTranslatedUiText>[1],
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(uiLanguage, key, params)

  const paragraphs: string[] = expanded
    ? [
      letter.content.greeting,
      letter.content.summary,
      letter.content.suggestion,
      letter.content.intention,
      letter.content.experiment,
      letter.content.closing,
    ]
    : [letter.content.greeting]
  const bodyId = `settings-letter-card-body-${encodeURIComponent(letter.id)}`

  return (
    <li className="settings-letter-card">
      <div className="settings-letter-card__header">
        <strong className="settings-letter-card__date">{formatLetterDate(letter.letterDate, uiLanguage)}</strong>
        <div className="settings-letter-card__actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => void exportLetterToFile(letter)}
            title={ti('settings.letters.export_title')}
          >
            {ti('settings.letters.export')}
          </button>
          <button
            type="button"
            className="ghost-button"
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={onToggle}
          >
            {expanded ? ti('settings.letters.collapse') : ti('settings.letters.expand')}
          </button>
        </div>
      </div>

      <div className="settings-letter-card__meta">
        <span>{ti('settings.letters.active_days_label', { n: letter.weekDayCount })}</span>
        {letter.themes.length ? (
          <span>{ti('settings.letters.themes_label')}{letter.themes.join(', ')}</span>
        ) : null}
      </div>

      <div id={bodyId} className="settings-letter-card__body">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </li>
  )
}

export const LettersSection = memo(function LettersSection({
  active,
  uiLanguage,
}: LettersSectionProps) {
  const ti = (
    key: Parameters<typeof pickTranslatedUiText>[1],
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(uiLanguage, key, params)

  const [letters, setLetters] = useState<SavedLetter[]>(() => loadLetters())
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Reload when the user opens this tab — the scheduler may have written a
  // new letter while another tab was visible. Defer so the setState lands
  // in the next render rather than racing the parent's commit.
  useEffect(() => {
    if (!active) return
    const id = window.setTimeout(() => setLetters(loadLetters()), 0)
    return () => window.clearTimeout(id)
  }, [active])

  return (
    <section className={`settings-section settings-letter-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-mini-group settings-letter-group">
        <div className="settings-mini-group__head settings-letter-group__head">
          <h5>{ti('settings.section_eyebrow.letters')}</h5>
          <span>{ti('settings.letters.note')}</span>
        </div>

        {letters.length === 0 ? (
          <div className="settings-letter-empty" role="status">
            <strong>{ti('settings.letters.empty_state')}</strong>
            <span className="settings-letter-empty__label">{ti('settings.letters.empty_hint')}</span>
          </div>
        ) : (
          <ul className="settings-letter-list">
            {letters.map((letter) => (
              <LetterCard
                key={letter.id}
                letter={letter}
                uiLanguage={uiLanguage}
                expanded={expandedId === letter.id}
                onToggle={() => setExpandedId((current) => (current === letter.id ? null : letter.id))}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
})
