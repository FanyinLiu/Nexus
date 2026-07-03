import {
  UI_LANGUAGE_OPTIONS,
  getDefaultCompanionName,
  getDefaultUserName,
  isLocaleDefaultCompanionName,
  isLocaleDefaultUserName,
  pickTranslatedUiText,
} from '../../../../lib/uiLanguage'
import {
  setCompanionNameWithWakeWordSync,
  syncWakeWordWithCompanionNameChange,
} from '../../../hearing/companionWakeWordSync.ts'
import type { AppSettings } from '../../../../types'
import type { OnboardingDraftSetter } from './types'

type WelcomeStepProps = {
  draft: AppSettings
  setDraft: OnboardingDraftSetter
}

export function WelcomeStep({ draft, setDraft }: WelcomeStepProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) =>
    pickTranslatedUiText(draft.uiLanguage, key)
  return (
    <div className="onboarding-grid onboarding-grid--stack">
      <label>
        <span>{ti('onboarding.welcome.language_label')}</span>
        <select
          value={draft.uiLanguage}
          onChange={(event) => {
            const next = event.target.value as AppSettings['uiLanguage']
            setDraft((current) => syncWakeWordWithCompanionNameChange(current, {
              ...current,
              uiLanguage: next,
              companionName: isLocaleDefaultCompanionName(current.companionName)
                ? getDefaultCompanionName(next)
                : current.companionName,
              userName: isLocaleDefaultUserName(current.userName)
                ? getDefaultUserName(next)
                : current.userName,
            }))
          }}
        >
          {UI_LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.nativeLabel} · {option.englishLabel}
            </option>
          ))}
        </select>
      </label>

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
    </div>
  )
}
