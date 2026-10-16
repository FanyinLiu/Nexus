import type { CSSProperties } from 'react'
import {
  COMPANION_THEME_IDS,
  getCompanionAppearance,
} from '../features/themes/companionThemes.ts'
import { useTheme } from '../features/themes/useTheme.ts'
import { pickTranslatedUiText } from '../lib/uiLanguage.ts'
import type { AppLocale } from '../types/i18n.ts'
import type { CompanionThemeId, ThemeColorScheme, ThemeId } from '../types/theme.ts'

const THEME_LABEL_KEY = {
  warm: 'settings.appearance.warm',
  system: 'settings.appearance.system',
  playful: 'settings.appearance.playful',
} as const

const THEME_HINT_KEY = {
  warm: 'settings.appearance.warm_hint',
  system: 'settings.appearance.system_hint',
  playful: 'settings.appearance.playful_hint',
} as const

type CompanionThemePickerProps = {
  themeId: ThemeId
  colorScheme: ThemeColorScheme
  language: AppLocale
  onChange: (next: { themeId: CompanionThemeId; colorScheme: ThemeColorScheme }) => void
}

export function CompanionThemePicker({
  themeId,
  colorScheme,
  language,
  onChange,
}: CompanionThemePickerProps) {
  const { previewCompanionAppearance } = useTheme()
  const ti = (
    key: Parameters<typeof pickTranslatedUiText>[1],
  ) => pickTranslatedUiText(language, key)

  function selectTheme(nextThemeId: CompanionThemeId) {
    const next = { themeId: nextThemeId, colorScheme }
    onChange(next)
    previewCompanionAppearance(next)
  }

  function selectScheme(nextScheme: ThemeColorScheme) {
    const nextThemeId = themeId === 'system' || themeId === 'playful' || themeId === 'warm'
      ? themeId
      : 'warm'
    const next = { themeId: nextThemeId, colorScheme: nextScheme }
    onChange(next)
    previewCompanionAppearance(next)
  }

  return (
    <section className="companion-theme-picker">
      <div
        className="companion-theme-picker__looks"
        role="radiogroup"
        aria-label={ti('settings.appearance.label')}
      >
        {COMPANION_THEME_IDS.map((id) => {
          const swatch = getCompanionAppearance(id, 'light')
          const selected = themeId === id
          const style = {
            '--companion-swatch-surface': swatch.tokens.surface,
            '--companion-swatch-elevated': swatch.tokens.surfaceElevated,
            '--companion-swatch-accent': swatch.tokens.accent,
            '--companion-swatch-ink': swatch.tokens.textPrimary,
          } as CSSProperties
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={selected ? 'companion-theme-picker__look is-selected' : 'companion-theme-picker__look'}
              style={style}
              onClick={() => selectTheme(id)}
            >
              <span className="companion-theme-picker__swatch" aria-hidden="true">
                <span className="companion-theme-picker__swatch-card" />
                <span className="companion-theme-picker__swatch-dot" />
              </span>
              <span className="companion-theme-picker__name">{ti(THEME_LABEL_KEY[id])}</span>
              <span className="companion-theme-picker__hint">{ti(THEME_HINT_KEY[id])}</span>
            </button>
          )
        })}
      </div>
      <div
        className="companion-theme-picker__schemes"
        role="radiogroup"
        aria-label={ti('settings.appearance.scheme')}
      >
        {(['light', 'dark'] as const).map((scheme) => (
          <button
            key={scheme}
            type="button"
            role="radio"
            aria-checked={colorScheme === scheme}
            className={colorScheme === scheme ? 'is-selected' : ''}
            onClick={() => selectScheme(scheme)}
          >
            {ti(scheme === 'light' ? 'settings.appearance.light' : 'settings.appearance.dark')}
          </button>
        ))}
      </div>
      <p className="companion-theme-picker__note">{ti('settings.appearance.scheme_hint')}</p>
    </section>
  )
}
