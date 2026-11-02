/**
 * The letter card that sits under a future-self capsule's opener.
 *
 * It is the user's own writing, not the companion speaking, so the card has no
 * avatar, no name and no actions; it only restates the letter verbatim. The
 * header falls back to a localized default when the capsule was saved without
 * a title, and the bottom line is the local writing date — both resolved at
 * render time so a language switch re-renders the same stored letter.
 */

import { formatCapsuleWrittenLabel } from '../features/futureCapsule/futureCapsuleDelivery.ts'
import { useTranslation } from '../i18n/useTranslation.ts'
import type { ChatMessage } from '../types/chat.ts'
import './capsule-letter-card.css'

export function CapsuleLetterCard({ letter }: {
  letter: NonNullable<ChatMessage['capsuleLetter']>
}) {
  const { t, locale } = useTranslation()
  const title = letter.title?.trim() || t('chat.capsule.header.default')
  const writtenLabel = formatCapsuleWrittenLabel(letter.writtenAt, locale)

  return (
    <article className="capsule-letter-card" aria-label={title}>
      <p className="capsule-letter-card__title">{title}</p>
      <p className="capsule-letter-card__body">{letter.body}</p>
      {writtenLabel ? (
        <p className="capsule-letter-card__date">{writtenLabel}</p>
      ) : null}
    </article>
  )
}
