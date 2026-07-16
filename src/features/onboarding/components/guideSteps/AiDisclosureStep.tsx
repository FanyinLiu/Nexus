// Read-only onboarding step that fulfills the SB 243 / NY companion-AI
// "clear and conspicuous" initial-disclosure requirement. Sits as
// step 1 of the onboarding flow so users see it before naming the
// companion or wiring providers.

import { useState } from 'react'
import { pickTranslatedUiText } from '../../../../lib/uiLanguage'
import type { AppSettings } from '../../../../types'

interface Props {
  draft: AppSettings
}

export function AiDisclosureStep({ draft }: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) =>
    pickTranslatedUiText(draft.uiLanguage, key)

  return (
    <div className="onboarding-grid onboarding-grid--stack ai-disclosure-step">
      <h2 id="onboarding-dialog-title">{ti('onboarding.step.ai_disclosure.title')}</h2>
      <span className="ai-disclosure-step__accent" aria-hidden="true" />

      <div id="onboarding-dialog-description" className="ai-disclosure-step__summary">
        <p>{ti('onboarding.ai_disclosure.lead')}</p>
        <p>{ti('onboarding.ai_disclosure.bullet_panel')}</p>
      </div>

      <details
        className="ai-disclosure-step__details"
        open={detailsOpen}
        onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
      >
        <summary
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            setDetailsOpen((current) => !current)
          }}
        >
          <span>{ti('onboarding.step.ai_disclosure.description')}</span>
          <span className="ai-disclosure-step__chevron" aria-hidden="true" />
        </summary>
        <ul className="ai-disclosure-step__bullets">
          <li>{ti('onboarding.ai_disclosure.bullet_not_human')}</li>
          <li>{ti('onboarding.ai_disclosure.bullet_not_clinical')}</li>
        </ul>
      </details>
    </div>
  )
}
