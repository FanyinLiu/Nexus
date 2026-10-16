import { pickTranslatedUiText } from '../../../../lib/uiLanguage.ts'
import { setCompanionNameWithWakeWordSync } from '../../../hearing/companionWakeWordSync.ts'
import type { AppSettings } from '../../../../types'
import type { OnboardingDraftSetter } from './types.ts'

type WelcomeStepProps = {
  draft: AppSettings
  setDraft: OnboardingDraftSetter
}

export function WelcomeStep({ draft, setDraft }: WelcomeStepProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) =>
    pickTranslatedUiText(draft.uiLanguage, key)
  return (
    <div className="onboarding-grid onboarding-grid--two">
      <label>
        <span>{ti('onboarding.welcome.user_name_label')}</span>
        <input
          value={draft.userName}
          onChange={(event) => setDraft((current) => ({
            ...current,
            userName: event.target.value,
          }))}
          placeholder={ti('onboarding.welcome.user_name_placeholder')}
        />
      </label>

      <label>
        <span>{ti('onboarding.welcome.companion_name_label')}</span>
        <input
          value={draft.companionName}
          onChange={(event) => setDraft((current) =>
            setCompanionNameWithWakeWordSync(current, event.target.value),
          )}
          placeholder={ti('onboarding.welcome.companion_name_placeholder')}
        />
      </label>
    </div>
  )
}
