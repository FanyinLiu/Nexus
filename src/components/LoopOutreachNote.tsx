/**
 * The night-before card and the "why this came up" disclosure.
 * Copy comes from the message. The buttons only report the user's choice.
 */

import { useTranslation } from '../i18n/useTranslation.ts'
import type { ChatMessage } from '../types/chat.ts'

type LoopOutreachNoteProps = {
  loopOffer?: ChatMessage['loopOffer']
  proactiveWhy?: ChatMessage['proactiveWhy']
  messageId?: string
}

export function LoopOutreachNote({ loopOffer, proactiveWhy, messageId }: LoopOutreachNoteProps) {
  const { t } = useTranslation()
  if (!loopOffer && !proactiveWhy) return null
  const accept = () => {
    if (!loopOffer || loopOffer.status !== 'pending') return
    window.dispatchEvent(new CustomEvent('nexus:accept-loop-offer', {
      detail: { memoryId: loopOffer.memoryId, messageId, nightBeforeAt: loopOffer.nightBeforeAt },
    }))
  }
  const decline = () => {
    if (!loopOffer || loopOffer.status !== 'pending') return
    window.dispatchEvent(new CustomEvent('nexus:decline-loop-offer', {
      detail: { memoryId: loopOffer.memoryId, messageId },
    }))
  }
  return (
    <div className="loop-outreach">
      {loopOffer ? (
        <div className="loop-outreach__card" data-loop-offer={loopOffer.status}>
          <p className="loop-outreach__title">{t('proactive.loop.card_title')}</p>
          {loopOffer.status === 'pending' ? (
            <div className="loop-outreach__actions">
              <button type="button" className="loop-outreach__accept" onClick={accept}>
                {t('proactive.loop.card_accept')}
              </button>
              <button type="button" className="loop-outreach__decline" onClick={decline}>
                {t('proactive.loop.card_decline')}
              </button>
            </div>
          ) : (
            <p className="loop-outreach__status">
              {loopOffer.status === 'accepted'
                ? t('proactive.loop.card_accepted')
                : t('proactive.loop.card_declined')}
            </p>
          )}
        </div>
      ) : null}
      {proactiveWhy ? (
        <details className="loop-outreach__why">
          <summary>{t('proactive.loop.why')}</summary>
          <p>{proactiveWhy.summary}</p>
          <p>{t('proactive.loop.why_body', { quote: proactiveWhy.quote, when: proactiveWhy.at.slice(0, 10) })}</p>
          {proactiveWhy.place ? <p>{proactiveWhy.place}</p> : null}
        </details>
      ) : null
      }
    </div>
  )
}
