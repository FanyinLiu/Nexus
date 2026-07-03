import { pickTranslatedUiText } from '../../../../lib/uiLanguage'
import type { UiLanguage } from '../../../../types/i18n'
import { buildOnboardingMessageActionDemo } from '../../messageActionDemo'

type MessageActionDemoStepProps = {
  uiLanguage: UiLanguage
}

export function MessageActionDemoStep({ uiLanguage }: MessageActionDemoStepProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) =>
    pickTranslatedUiText(uiLanguage, key)
  const demo = buildOnboardingMessageActionDemo()

  return (
    <div className="onboarding-grid onboarding-grid--stack onboarding-message-demo">
      <div className="onboarding-message-demo__header">
        <span className="onboarding-message-demo__source">
          {ti(demo.sourceLabelKey)}
          <strong>{ti(demo.sourceValueKey)}</strong>
        </span>
        <div>
          <strong>{ti(demo.titleKey)}</strong>
          <p>{ti(demo.introKey)}</p>
          <p className="onboarding-message-demo__privacy">{ti(demo.privacyNoteKey)}</p>
        </div>
      </div>

      <ol className="onboarding-message-demo__steps" aria-label={ti(demo.titleKey)}>
        {demo.steps.map((step, index) => (
          <li key={step.id} className="onboarding-message-demo__step">
            <span className="onboarding-message-demo__index" aria-hidden="true">
              {index + 1}
            </span>
            <div>
              <strong>{ti(step.labelKey)}</strong>
              <p>{ti(step.descriptionKey)}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="onboarding-message-demo__actions" aria-label={ti('panel.notification.title')}>
        {demo.actions.map((action) => (
          <span key={action.id} className="onboarding-message-demo__action">
            {ti(action.labelKey)}
          </span>
        ))}
      </div>
    </div>
  )
}
