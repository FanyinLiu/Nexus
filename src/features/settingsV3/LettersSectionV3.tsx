import { memo, useEffect, useState } from 'react'
import {
  loadLetters,
  markLetterRead,
  type SavedLetter,
} from '../letter/letterStore.ts'
import { formatLetterDate, isLetterUnread, letterParagraphs } from '../letter/letterView.ts'
import { saveTextFileWithFallback } from '../../lib/textFiles.ts'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'
import { pickTranslatedUiText } from '../../lib/uiLanguage.ts'
import type { UiLanguage } from '../../types'
import { SettingsV3Empty, SettingsV3Page, SettingsV3Section, SettingsV3Toolbar } from './SettingsV3Primitives.tsx'
import './settings-v3-collection.css'

type LettersSectionV3Props = { active: boolean; uiLanguage: UiLanguage }

async function exportLetter(letter: SavedLetter, title: string): Promise<void> {
  try {
    const { buildLetterFilename, renderLetterHtml } = await import('../letter/letterExport')
    await saveTextFileWithFallback({
      title,
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

  const toggleLetter = (letter: SavedLetter) => {
    const expanded = letter.id === expandedId
    if (!expanded) {
      markLetterRead(letter.id)
      setLetters(loadLetters())
    }
    setExpandedId(expanded ? null : letter.id)
  }

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
              const unread = isLetterUnread(letter)
              const bodyId = `settings-v3-letter-${encodeURIComponent(letter.id)}`
              return (
                <li key={letter.id} className="settings-v3-collection-row">
                  <button
                    type="button"
                    className="settings-v3-collection-row__main"
                    aria-expanded={expanded}
                    aria-controls={bodyId}
                    onClick={() => toggleLetter(letter)}
                  >
                    <span className="settings-v3-collection-row__title">
                      {formatLetterDate(letter.letterDate, uiLanguage)}
                    </span>
                    <span className="settings-v3-collection-row__preview">{letter.content.greeting}</span>
                    <span className="settings-v3-collection-row__meta">
                      {unread ? `${ti('settings.letters.unread_badge')} · ` : ''}
                      {ti('settings.letters.active_days_label', { n: letter.weekDayCount })}
                    </span>
                  </button>
                  <SettingsV3Toolbar>
                    <button type="button" onClick={() => void exportLetter(letter, ti('settings.letters.save_dialog_title'))}>{ti('settings.letters.export')}</button>
                  </SettingsV3Toolbar>
                  {expanded ? (
                    <div id={bodyId} className="settings-v3-letter-body">
                      {letterParagraphs(letter).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
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
