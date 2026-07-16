import { memo, useEffect, useState } from 'react'
import { loadLetters, type SavedLetter } from '../letter/letterStore'
import { saveTextFileWithFallback } from '../../lib/textFiles'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { UiLanguage } from '../../types'
import { SettingsV3Empty, SettingsV3Page, SettingsV3Section, SettingsV3Toolbar } from './SettingsV3Primitives'
import './settings-v3-collection.css'

type LettersSectionV3Props = { active: boolean; uiLanguage: UiLanguage }

function formatLetterDate(value: string, language: UiLanguage): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Intl.DateTimeFormat(language === 'en-US' ? 'en-US' : language, {
    dateStyle: 'long',
  }).format(new Date(timestamp))
}

async function exportLetter(letter: SavedLetter): Promise<void> {
  try {
    const { buildLetterFilename, renderLetterHtml } = await import('../letter/letterExport')
    await saveTextFileWithFallback({
      title: 'Save letter',
      content: renderLetterHtml(letter),
      defaultFileName: buildLetterFilename(letter),
    })
  } catch (error) {
    console.warn('[letter-export] failed:', getRedactedLogErrorMessage(error))
  }
}

export const LettersSectionV3 = memo(function LettersSectionV3({ active, uiLanguage }: LettersSectionV3Props) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1], params?: Parameters<typeof pickTranslatedUiText>[2]) =>
    pickTranslatedUiText(uiLanguage, key, params)
  const [letters, setLetters] = useState<SavedLetter[]>(() => loadLetters())
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return undefined
    const timeoutId = window.setTimeout(() => setLetters(loadLetters()), 0)
    return () => window.clearTimeout(timeoutId)
  }, [active])

  return (
    <SettingsV3Page className={`${letters.length === 0 ? 'settings-v3-page--fill' : ''} ${active ? '' : 'is-hidden'}`.trim()}>
      <SettingsV3Section
        title={ti('settings.section_eyebrow.letters')}
        description={ti('settings.letters.note')}
        fill={letters.length === 0}
      >
        {letters.length === 0 ? (
          <SettingsV3Empty title={ti('settings.letters.empty_state')} description={ti('settings.letters.empty_hint')} />
        ) : (
          <ul className="settings-v3-collection" aria-label={ti('settings.section_eyebrow.letters')}>
            {letters.map((letter) => {
              const expanded = letter.id === expandedId
              const bodyId = `settings-v3-letter-${encodeURIComponent(letter.id)}`
              const paragraphs = [
                letter.content.greeting,
                letter.content.summary,
                letter.content.suggestion,
                letter.content.intention,
                letter.content.experiment,
                letter.content.closing,
              ]
              return (
                <li key={letter.id} className="settings-v3-collection-row">
                  <button
                    type="button"
                    className="settings-v3-collection-row__main"
                    aria-expanded={expanded}
                    aria-controls={bodyId}
                    onClick={() => setExpandedId(expanded ? null : letter.id)}
                  >
                    <span className="settings-v3-collection-row__title">{formatLetterDate(letter.letterDate, uiLanguage)}</span>
                    <span className="settings-v3-collection-row__preview">{letter.content.greeting}</span>
                    <span className="settings-v3-collection-row__meta">
                      {ti('settings.letters.active_days_label', { n: letter.weekDayCount })}
                    </span>
                  </button>
                  <SettingsV3Toolbar>
                    <button type="button" onClick={() => void exportLetter(letter)}>{ti('settings.letters.export')}</button>
                  </SettingsV3Toolbar>
                  {expanded ? (
                    <div id={bodyId} className="settings-v3-letter-body">
                      {paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </SettingsV3Section>
    </SettingsV3Page>
  )
})
