/**
 * One reminder card: title, the line, the answer buttons, and a wrapping
 * "why this came up" link. The buttons only report the choice.
 */

import { useTranslation } from '../i18n/useTranslation.ts'
import type { ChatMessage } from '../types/chat.ts'
import {
  memoryTopicToken,
  plainMemoryName,
  type MemoryTopic,
} from '../features/memory/changeCopy.ts'

type LoopOutreachNoteProps = {
  body?: string
  loopOffer?: ChatMessage['loopOffer']
  loopCheck?: ChatMessage['loopCheck']
  proactiveWhy?: ChatMessage['proactiveWhy']
  messageId?: string
}

function topicLabel(
  topic: MemoryTopic | null,
  fallback: string,
  t: (key: 'memory.topic.passport' | 'memory.topic.report' | 'memory.topic.interview' | 'memory.topic.meeting' | 'memory.topic.note') => string,
): string {
  if (topic === 'passport') return t('memory.topic.passport')
  if (topic === 'report') return t('memory.topic.report')
  if (topic === 'interview') return t('memory.topic.interview')
  if (topic === 'meeting') return t('memory.topic.meeting')
  return fallback || t('memory.topic.note')
}

export function LoopOutreachNote({
  body,
  loopOffer,
  loopCheck,
  proactiveWhy,
  messageId,
}: LoopOutreachNoteProps) {
  const { t } = useTranslation()
  if (!loopOffer && !loopCheck && !proactiveWhy && !body) return null
  const source = loopOffer?.title || proactiveWhy?.summary || body || ''
  const heading = t('proactive.loop.card_title', {
    topic: topicLabel(memoryTopicToken(source), plainMemoryName(source), t),
  })
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
  const booked = (action: 'cancel' | 'reschedule', quote: string) => {
    if (!loopOffer || loopOffer.status !== 'booked') return
    window.dispatchEvent(new CustomEvent('nexus:loop-booked', {
      detail: { memoryId: loopOffer.memoryId, messageId, action, quote },
    }))
  }
  const answer = (action: 'done' | 'later' | 'moved', quote: string) => {
    if (!loopCheck || loopCheck.status !== 'pending') return
    window.dispatchEvent(new CustomEvent('nexus:loop-check', {
      detail: { memoryId: loopCheck.memoryId, messageId, action, quote },
    }))
  }
  const offerNote = loopOffer?.status === 'accepted'
    ? t('proactive.loop.card_accepted')
    : loopOffer?.status === 'declined'
      ? t('proactive.loop.card_declined')
      : loopOffer?.status === 'cancelled'
        ? t('proactive.loop.card_cancelled')
        : loopOffer?.status === 'rescheduled'
          ? t('proactive.loop.card_rescheduled')
          : ''
  const checkNote = loopCheck?.status === 'done'
    ? t('proactive.loop.check_done_note')
    : loopCheck?.status === 'later'
      ? t('proactive.loop.check_later_note')
      : loopCheck?.status === 'moved'
        ? t('proactive.loop.check_moved_note')
        : ''
  return (
    <div
      className="loop-outreach"
      data-loop-offer={loopOffer?.status}
      data-loop-check={loopCheck?.status}
    >
      <div className="loop-outreach__card nx-companion-card">
        <p className="loop-outreach__title">{heading}</p>
        {body ? <p className="loop-outreach__body">{body}</p> : null}
        {loopOffer?.status === 'pending' ? (
          <div className="loop-outreach__actions">
            <button type="button" className="loop-outreach__accept" onClick={accept}>
              {t('proactive.loop.card_accept')}
            </button>
            <button type="button" className="loop-outreach__decline" onClick={decline}>
              {t('proactive.loop.card_decline')}
            </button>
          </div>
        ) : null}
        {loopOffer?.status === 'booked' ? (
          <div className="loop-outreach__actions">
            <button
              type="button"
              className="loop-outreach__accept loop-outreach__reschedule"
              onClick={() => booked('reschedule', t('proactive.loop.card_reschedule'))}
            >
              {t('proactive.loop.card_reschedule')}
            </button>
            <button
              type="button"
              className="loop-outreach__decline loop-outreach__cancel"
              onClick={() => booked('cancel', t('proactive.loop.card_cancel'))}
            >
              {t('proactive.loop.card_cancel')}
            </button>
          </div>
        ) : null}
        {loopCheck?.status === 'pending' ? (
          <div className="loop-outreach__actions">
            <button
              type="button"
              className="loop-outreach__accept loop-outreach__check-done"
              onClick={() => answer('done', t('proactive.loop.check_done'))}
            >
              {t('proactive.loop.check_done')}
            </button>
            <button
              type="button"
              className="loop-outreach__decline loop-outreach__check-later"
              onClick={() => answer('later', t('proactive.loop.check_later'))}
            >
              {t('proactive.loop.check_later')}
            </button>
            <button
              type="button"
              className="loop-outreach__decline loop-outreach__check-moved"
              onClick={() => answer('moved', t('proactive.loop.check_moved'))}
            >
              {t('proactive.loop.check_moved')}
            </button>
          </div>
        ) : null}
        {offerNote || checkNote ? <p className="loop-outreach__status">{offerNote || checkNote}</p> : null}
        {proactiveWhy ? (
          <details className="loop-outreach__why">
            <summary>{t('proactive.loop.why')}</summary>
            <p>{proactiveWhy.summary}</p>
            <p>{t('proactive.loop.why_body', { quote: proactiveWhy.quote, when: proactiveWhy.at.slice(0, 10) })}</p>
            {proactiveWhy.place ? <p>{proactiveWhy.place}</p> : null}
          </details>
        ) : null}
      </div>
    </div>
  )
}
