import { UI_LANGUAGE_OPTIONS, pickTranslatedUiText } from '../../../../lib/uiLanguage.ts'
import type { AppSettings } from '../../../../types'
import type { UiLanguage } from '../../../../types/i18n.ts'

type LanguageStepProps = {
  draft: AppSettings
  onChooseLanguage: (language: UiLanguage) => void
}

export function LanguageStep({ draft, onChooseLanguage }: LanguageStepProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) =>
    pickTranslatedUiText(draft.uiLanguage, key)

  return (
    <div
      className="onboarding-relationship"
      role="radiogroup"
      aria-label={ti('onboarding.welcome.language_label')}
    >
      <div className="onboarding-relationship__options">
        {UI_LANGUAGE_OPTIONS.map((option) => {
          const selected = draft.uiLanguage === option.value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`onboarding-relationship__chip${selected ? ' is-active' : ''}`}
              onClick={() => onChooseLanguage(option.value)}
            >
              {option.nativeLabel}
            </button>
          )
        })}
      </div>
    </div>
  )
}
