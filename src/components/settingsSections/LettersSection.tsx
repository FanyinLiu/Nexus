import { memo, useEffect, useState } from 'react'
import { loadLetters, type SavedLetter } from '../../features/letter/letterStore'
import { buildLetterFilename, renderLetterHtml } from '../../features/letter/letterExport'
import { saveTextFileWithFallback } from '../../lib/textFiles'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { UiLanguage } from '../../types'

async function exportLetterToFile(letter: SavedLetter): Promise<void> {
  const html = renderLetterHtml(letter)
  const filename = buildLetterFilename(letter)
  try {
    await saveTextFileWithFallback({
      title: 'Save letter',
      content: html,
      defaultFileName: filename,
    })
  } catch (err) {
    console.warn('[letter-export] save failed:', err)
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

  return (
    <li
      style={{
        border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
        borderRadius: 10,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <strong style={{ fontSize: '1.05rem' }}>{formatLetterDate(letter.letterDate, uiLanguage)}</strong>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="ghost-button"
            onClick={() => void exportLetterToFile(letter)}
            title={ti('settings.letters.export_title')}
          >
            {ti('settings.letters.export')}
          </button>
          <button type="button" className="ghost-button" onClick={onToggle}>
            {expanded ? ti('settings.letters.collapse') : ti('settings.letters.expand')}
          </button>
        </div>
      </div>

      <div style={{ fontSize: '0.85rem', opacity: 0.75, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span>{ti('settings.letters.active_days_label', { n: letter.weekDayCount })}</span>
        {letter.themes.length ? (
          <span>{ti('settings.letters.themes_label')}{letter.themes.join(', ')}</span>
        ) : null}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, lineHeight: 1.6 }}>
        {paragraphs.map((p, i) => (
          <p key={i} style={{ margin: 0 }}>{p}</p>
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
    <section className={`settings-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-section__title-row">
        <div>
          <h4>{ti('settings.letters.title')}</h4>
          <p className="settings-drawer__hint">{ti('settings.letters.note')}</p>
        </div>
      </div>

      {letters.length === 0 ? (
        <p className="settings-drawer__hint">{ti('settings.letters.empty_state')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
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
    </section>
  )
})
