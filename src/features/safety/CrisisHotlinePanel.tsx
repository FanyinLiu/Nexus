// Non-persona crisis hotline overlay.
//
// Renders when the user's most recent message triggered a crisis
// detection (see crisisDetect.ts). Visually distinct from chat
// bubbles — it is a system surface, not the persona speaking. The
// persona's empathic reframe happens separately in the chat reply
// path.
//
// Roadmap: docs/ROADMAP.md → Tier 1.1, hybrid pattern decided
// 2026-04-28: persona stays in character + a non-persona hotline
// panel slides over the conversation. This component is the panel.

import { memo, useCallback } from 'react'

import { useTranslation } from '../../i18n/useTranslation.ts'
import type { AppLocale } from '../../types/i18n.ts'
import { useCrisisPanelState, dismissCrisis } from './crisisPanelState.ts'
import { HOTLINES } from './hotlines.ts'

interface Props {
  /**
   * UI locale to render the panel in. Usually the app's current
   * locale; passed in so the host controls language switching.
   */
  locale: AppLocale
}

/**
 * Returns true if `phone` looks like a number that would route via
 * `tel:` URI handlers. We accept digits, spaces, and hyphens; reject
 * web-chat-only entries (which use `url`, not `phone`).
 */
function isCallable(phone: string): boolean {
  return /^[\d\s\-+()]+$/.test(phone)
}

/**
 * Shortcodes (3- or 4-digit numbers like 988 or 1925) don't accept
 * SMS via the standard `sms:` URI in every region, but they do for
 * 988 in the US (text 988). For now we expose SMS only for 988 — add
 * other regions to this set as their providers confirm SMS handling.
 */
const SMS_CAPABLE_PHONES = new Set<string>(['988'])

function CrisisHotlinePanelInner({ locale }: Props) {
  const signal = useCrisisPanelState()
  const { t } = useTranslation()

  const handleDismiss = useCallback(() => {
    dismissCrisis()
  }, [])

  if (!signal) return null

  const hotlines = HOTLINES[locale]
  if (!hotlines || hotlines.length === 0) return null

  return (
    <aside
      className="crisis-hotline-panel"
      role="region"
      aria-live="polite"
      aria-label={t('safety.crisis.aria_label')}
    >
      <div className="crisis-hotline-panel__inner">
        <button
          type="button"
          className="crisis-hotline-panel__dismiss"
          aria-label={t('safety.crisis.dismiss_aria')}
          onClick={handleDismiss}
        >
          ×
        </button>

        <h2 className="crisis-hotline-panel__title">
          {t('safety.crisis.title')}
        </h2>
        <p className="crisis-hotline-panel__body">
          {t('safety.crisis.body')}
        </p>

        <ul className="crisis-hotline-panel__list">
          {hotlines.map((h) => {
            const callable = isCallable(h.phone)
            const smsCapable = SMS_CAPABLE_PHONES.has(h.phone)
            return (
              <li key={h.phone} className="crisis-hotline-panel__item">
                <div className="crisis-hotline-panel__item-name">
                  {h.name}
                </div>
                <div className="crisis-hotline-panel__item-phone">
                  {h.phone}
                </div>
                <div className="crisis-hotline-panel__item-hours">
                  {h.hoursLabel}
                </div>
                <div className="crisis-hotline-panel__item-actions">
                  {callable ? (
                    <a
                      className="crisis-hotline-panel__action"
                      href={`tel:${h.phone.replace(/[^\d+]/g, '')}`}
                    >
                      {t('safety.crisis.cta_call')}
                    </a>
                  ) : null}
                  {smsCapable ? (
                    <a
                      className="crisis-hotline-panel__action"
                      href={`sms:${h.phone}`}
                    >
                      {t('safety.crisis.cta_text')}
                    </a>
                  ) : null}
                  {h.url ? (
                    <a
                      className="crisis-hotline-panel__action"
                      href={h.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('safety.crisis.cta_chat')}
                    </a>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </aside>
  )
}

export const CrisisHotlinePanel = memo(CrisisHotlinePanelInner)
