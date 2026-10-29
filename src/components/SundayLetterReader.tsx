/**
 * Full-letter reader used by the V2 chat notice and the memory-page shelf.
 * The caller marks the letter read when opening; this component only renders.
 */

import { useEffect } from 'react'
import type { SavedLetter } from '../features/letter/letterStore.ts'
import { formatLetterDate, letterParagraphs } from '../features/letter/letterView.ts'
import { pickTranslatedUiText } from '../lib/uiLanguage.ts'
import type { UiLanguage } from '../types'
import '../features/settingsV3/memory-portrait.css'

export function SundayLetterReader({ letter, uiLanguage, onClose }: {
  letter: SavedLetter
  uiLanguage: UiLanguage
  onClose: () => void
}) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) =>
    pickTranslatedUiText(uiLanguage, key)
  const title = ti('settings.letters.reader_title')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="memory-portrait__sheet sunday-letter-reader" role="dialog" aria-modal="true" aria-label={title}>
      <article className="memory-portrait__sheet-card sunday-letter-reader__card">
        <div className="memory-portrait__sheet-head">
          <h3>{title}</h3>
          <button type="button" onClick={onClose}>{ti('settings.letters.close')}</button>
        </div>
        <p className="memory-portrait__label">{formatLetterDate(letter.letterDate, uiLanguage)}</p>
        <div className="sunday-letter-reader__body">
          {letterParagraphs(letter).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        </div>
      </article>
    </div>
  )
}
