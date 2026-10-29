/**
 * Re-readable letter shelf opened from the simple Memory page. Newest first,
 * with unread badges; opening a row marks it read and swaps to the reader.
 */

import { useState } from 'react'
import { markLetterRead, type SavedLetter } from '../features/letter/letterStore.ts'
import { formatLetterDate, isLetterUnread } from '../features/letter/letterView.ts'
import { pickTranslatedUiText } from '../lib/uiLanguage.ts'
import type { UiLanguage } from '../types'
import { SundayLetterReader } from './SundayLetterReader.tsx'
import '../features/settingsV3/memory-portrait.css'

export function SundayLetterShelf({ letters, uiLanguage, onClose }: {
  letters: readonly SavedLetter[]
  uiLanguage: UiLanguage
  onClose: () => void
}) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) =>
    pickTranslatedUiText(uiLanguage, key)
  const [readAtById, setReadAtById] = useState<Record<string, string>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const items = letters.map((letter) => (
    readAtById[letter.id] ? { ...letter, readAt: readAtById[letter.id] } : letter
  ))

  const selected = items.find((letter) => letter.id === selectedId) ?? null
  if (selected) {
    return (
      <SundayLetterReader
        letter={selected}
        uiLanguage={uiLanguage}
        onClose={() => setSelectedId(null)}
      />
    )
  }

  const openLetter = (letter: SavedLetter) => {
    const updated = markLetterRead(letter.id)
    if (updated?.readAt) {
      setReadAtById((current) => ({ ...current, [updated.id]: updated.readAt as string }))
    }
    setSelectedId(letter.id)
  }

  return (
    <div className="memory-portrait__sheet" role="dialog" aria-modal="true" aria-label={ti('settings.letters.shelf_title')}>
      <div className="memory-portrait__sheet-card">
        <div className="memory-portrait__sheet-head">
          <h3>{ti('settings.letters.shelf_title')}</h3>
          <button type="button" onClick={onClose}>{ti('settings.letters.close')}</button>
        </div>
        <p className="memory-portrait__label">{ti('settings.letters.shelf_description')}</p>
        {items.length === 0 ? (
          <p className="memory-timeline__notice">{ti('settings.letters.empty_state')}</p>
        ) : (
          <ul className="sunday-letter-shelf__list">
            {items.map((letter) => {
              const unread = isLetterUnread(letter)
              return (
                <li key={letter.id} className="sunday-letter-shelf__item">
                  <button
                    type="button"
                    className="sunday-letter-shelf__open"
                    onClick={() => openLetter(letter)}
                  >
                    <span className="sunday-letter-shelf__meta">
                      <span className="sunday-letter-shelf__date">
                        {formatLetterDate(letter.letterDate, uiLanguage)}
                      </span>
                      <span className="sunday-letter-shelf__badge" data-unread={unread ? 'true' : 'false'}>
                        {unread ? ti('settings.letters.unread_badge') : ti('settings.letters.read_badge')}
                      </span>
                    </span>
                    <span className="sunday-letter-shelf__preview">{letter.content.greeting}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
