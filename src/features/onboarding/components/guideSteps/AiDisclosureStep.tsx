// Read-only onboarding step that fulfills the SB 243 / NY companion-AI
// "clear and conspicuous" initial-disclosure requirement. Sits as
// step 1 of the onboarding flow so users see it before naming the
// companion or wiring providers.

import { pickTranslatedUiText } from '../../../../lib/uiLanguage'
import type { AppSettings } from '../../../../types'

interface Props {
  draft: AppSettings
}

export function AiDisclosureStep({ draft }: Props) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) =>
    pickTranslatedUiText(draft.uiLanguage, key)

  return (
    <div className="onboarding-grid onboarding-grid--stack ai-disclosure-step">
      <p className="ai-disclosure-step__lead">
        {ti('onboarding.ai_disclosure.lead')}
      </p>
      <ul className="ai-disclosure-step__bullets">
        <li>{ti('onboarding.ai_disclosure.bullet_not_human')}</li>
        <li>{ti('onboarding.ai_disclosure.bullet_not_clinical')}</li>
        <li>{ti('onboarding.ai_disclosure.bullet_panel')}</li>
      </ul>
      <p className="ai-disclosure-step__continue-note">
        {ti('onboarding.ai_disclosure.continue_note')}
      </p>
    </div>
  )
}
