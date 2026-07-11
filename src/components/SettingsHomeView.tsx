import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
} from 'react'
import type { SettingsTrustSurfaceGroupId } from './settingsDrawerMetadata.ts'
import { renderSettingsCardIcon } from './settingsDrawerIcons.tsx'
import {
  SETTINGS_APPEARANCE_OPTIONS,
  type SettingsAppearanceTone,
  type SettingsSectionId,
} from './settingsDrawerSupport.ts'
import { SettingsHomePresence } from './SettingsHomePresence.tsx'
import type {
  SettingsHomeActionEntry,
  SettingsHomeGroupId,
} from './settingsHomeArchitecture.ts'
import type { TranslationKey, Translator } from '../types/i18n.ts'

export type SettingsHomeCardViewModel = {
  key: string
  sectionId: SettingsSectionId
  title: string
  glyph: string
  preview: readonly string[]
  trustGroup: SettingsTrustSurfaceGroupId
}

export type SettingsHomeGroupViewModel = {
  id: SettingsHomeGroupId
  titleKey: TranslationKey
  hintKey: TranslationKey
  cards: readonly SettingsHomeCardViewModel[]
  actions?: readonly SettingsHomeActionEntry[]
}

export type SettingsHomeViewProps = {
  appearanceOptionRefs: MutableRefObject<Array<HTMLButtonElement | null>>
  groups: readonly SettingsHomeGroupViewModel[]
  presence: {
    badge: string
    title: string
    body: string
  }
  selectedAppearanceIndex: number
  settingsHomeCardRefs: MutableRefObject<Partial<Record<SettingsSectionId, HTMLButtonElement | null>>>
  settingsThemeTone: SettingsAppearanceTone
  ti: Translator
  onAppearanceOptionKeyDown: (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    optionIndex: number,
  ) => void
  onOpenHomeAction: (action: SettingsHomeActionEntry) => void
  onPreloadSettingsSection: (sectionId: SettingsSectionId) => void
  onOpenSettingsSection: (sectionId: SettingsSectionId) => void
  onSelectAppearanceOption: (optionIndex: number) => void
}

export function SettingsHomeView({
  appearanceOptionRefs,
  groups,
  presence,
  selectedAppearanceIndex,
  settingsHomeCardRefs,
  settingsThemeTone,
  ti,
  onAppearanceOptionKeyDown,
  onOpenHomeAction,
  onPreloadSettingsSection,
  onOpenSettingsSection,
  onSelectAppearanceOption,
}: SettingsHomeViewProps) {
  function renderSettingsHomeSectionCard(card: SettingsHomeCardViewModel) {
    const previewText = card.preview.filter(Boolean).join(' / ')
    const cardLabel = previewText ? `${card.title}: ${previewText}` : card.title

    return (
      <button
        ref={(node) => {
          settingsHomeCardRefs.current[card.sectionId] = node
        }}
        key={card.key}
        type="button"
        className="settings-home-card"
        data-section={card.key}
        data-trust-group={card.trustGroup}
        data-focus-return-section={card.sectionId}
        aria-label={cardLabel}
        title={cardLabel}
        onPointerEnter={() => onPreloadSettingsSection(card.sectionId)}
        onFocus={() => onPreloadSettingsSection(card.sectionId)}
        onClick={() => onOpenSettingsSection(card.sectionId)}
      >
        <span className="settings-home-card__glyph" aria-hidden="true">
          {renderSettingsCardIcon(card.glyph)}
        </span>
        <span className="settings-home-card__copy">
          <span className="settings-home-card__label">{card.title}</span>
          <span className="settings-home-card__value">{previewText}</span>
        </span>
        <span className="settings-home-card__chevron" aria-hidden="true">
          &gt;
        </span>
      </button>
    )
  }

  function renderSettingsAppearanceSwitch() {
    return (
      <div className="settings-appearance-switch" role="radiogroup" aria-label={ti('settings.appearance.label')}>
        <span className="settings-appearance-switch__label">{ti('settings.appearance.label')}</span>
        <div className="settings-appearance-switch__control">
          {SETTINGS_APPEARANCE_OPTIONS.map((option, optionIndex) => {
            const isActive = option.tone === settingsThemeTone
            const optionLabel = ti(option.labelKey)
            const optionTitle = `${ti('settings.appearance.label')}: ${optionLabel}`
            const optionStyle = {
              '--settings-theme-swatch-surface': option.swatch.surface,
              '--settings-theme-swatch-accent': option.swatch.accent,
            } as CSSProperties

            return (
              <button
                ref={(node) => {
                  appearanceOptionRefs.current[optionIndex] = node
                }}
                key={option.id}
                type="button"
                className={`settings-appearance-switch__option ${isActive ? 'is-active' : ''}`}
                role="radio"
                aria-checked={isActive}
                aria-label={optionTitle}
                tabIndex={optionIndex === selectedAppearanceIndex ? 0 : -1}
                title={optionTitle}
                style={optionStyle}
                onClick={() => onSelectAppearanceOption(optionIndex)}
                onKeyDown={(event) => onAppearanceOptionKeyDown(event, optionIndex)}
              >
                <span className="settings-appearance-switch__swatch" aria-hidden="true" />
                <span className="settings-appearance-switch__option-label">{optionLabel}</span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  function renderSettingsHomeAction(action: SettingsHomeActionEntry) {
    const actionTitle = ti(action.titleKey)
    const actionValue = ti(action.valueKey)

    return (
      <button
        key={action.actionId}
        type="button"
        className="settings-home-card settings-home-card--action"
        data-section={action.actionId}
        data-trust-group={action.trustGroup}
        aria-label={ti(action.ariaLabelKey)}
        title={ti(action.ariaLabelKey)}
        onClick={() => onOpenHomeAction(action)}
      >
        <span className="settings-home-card__glyph" aria-hidden="true">
          {renderSettingsCardIcon(action.glyph)}
        </span>
        <span className="settings-home-card__copy">
          <span className="settings-home-card__label">{actionTitle}</span>
          <span className="settings-home-card__value">{actionValue}</span>
        </span>
        <span className="settings-home-card__chevron" aria-hidden="true">
          &gt;
        </span>
      </button>
    )
  }

  return (
    <div className="settings-home">
      <SettingsHomePresence
        badge={presence.badge}
        title={presence.title}
        body={presence.body}
      />
      {groups.map((group) => (
        <section
          key={group.id}
          className="settings-home-group"
          data-settings-home-group={group.id}
        >
          <div className="settings-home-group__head">
            <span className="settings-home-group__title">{ti(group.titleKey)}</span>
            <span className="settings-home-group__hint">{ti(group.hintKey)}</span>
          </div>
          <div className="settings-home-group__list">
            {group.id === 'appearanceExperience' ? renderSettingsAppearanceSwitch() : null}
            {group.cards.map((card) => renderSettingsHomeSectionCard(card))}
            {group.actions?.map((action) => renderSettingsHomeAction(action))}
          </div>
        </section>
      ))}
    </div>
  )
}
