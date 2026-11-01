/**
 * Settings child-page section rail. Kept presentational: the drawer owns the
 * active section and the renderer owns section metadata.
 */

import { renderSettingsCardIcon } from '../settingsDrawerIcons.tsx'
import type { SettingsSectionMetaMap } from '../settingsDrawerMetadata.ts'
import type { getSettingsSectionOptions, SettingsSectionId } from '../settingsDrawerSupport.ts'

type SettingsSectionOption = ReturnType<typeof getSettingsSectionOptions>[number]

export type SettingsDrawerSectionNavProps = {
  activeSectionId: SettingsSectionId
  label: string
  options: readonly SettingsSectionOption[]
  sectionMetaById: SettingsSectionMetaMap
  onOpenSettingsSection: (sectionId: SettingsSectionId) => void
}

export function SettingsDrawerSectionNav({
  activeSectionId,
  label,
  options,
  sectionMetaById,
  onOpenSettingsSection,
}: SettingsDrawerSectionNavProps) {
  return (
    <nav className="settings-section-nav" aria-label={label}>
      {options.map((section) => {
        const isActive = section.id === activeSectionId
        const sectionMeta = sectionMetaById[section.id]

        return (
          <button
            key={section.id}
            type="button"
            className={`settings-section-nav__button ${isActive ? 'is-active' : ''}`}
            data-section={section.id}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onOpenSettingsSection(section.id)}
          >
            <span className="settings-section-nav__marker" aria-hidden="true">
              {renderSettingsCardIcon(sectionMeta.glyph)}
            </span>
            <span className="settings-section-nav__label">{section.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
