/**
 * Settings child-page frame: back control, section heading, section rail, and
 * the scroll container that hosts the active settings section. The drawer keeps
 * the heading ref so focus handoff remains owned by the drawer.
 */

import type { ReactNode, RefObject } from 'react'
import { renderSettingsCardIcon } from '../settingsDrawerIcons.tsx'
import { PetControlIcon } from '../PetControlIcon.tsx'
import { SettingsDrawerSectionNav } from './SettingsDrawerSectionNav.tsx'
import type { SettingsSectionMetaMap } from '../settingsDrawerMetadata.ts'
import type { getSettingsSectionOptions, SettingsSectionId } from '../settingsDrawerSupport.ts'
import type { Translator } from '../../types/index.ts'

type SettingsSectionOption = ReturnType<typeof getSettingsSectionOptions>[number]

export type SettingsDrawerSectionPageProps = {
  activeSectionDescription: string
  activeSectionHeadingRef: RefObject<HTMLHeadingElement | null>
  activeSectionId: SettingsSectionId
  activeSectionLabel: string
  activeSectionMeta: SettingsSectionMetaMap[SettingsSectionId]
  children: ReactNode
  onBack: () => void
  onOpenSettingsSection: (sectionId: SettingsSectionId) => void
  options: readonly SettingsSectionOption[]
  sectionMetaById: SettingsSectionMetaMap
  sectionsRef: RefObject<HTMLDivElement | null>
  ti: Translator
}

export function SettingsDrawerSectionPage({
  activeSectionDescription,
  activeSectionHeadingRef,
  activeSectionId,
  activeSectionLabel,
  activeSectionMeta,
  children,
  onBack,
  onOpenSettingsSection,
  options,
  sectionMetaById,
  sectionsRef,
  ti,
}: SettingsDrawerSectionPageProps) {
  return (
    <div className="settings-page sp" data-section={activeSectionId}>
      <div className="settings-page__layout">
        <SettingsDrawerSectionNav
          activeSectionId={activeSectionId}
          label={ti('settings.title')}
          options={options}
          sectionMetaById={sectionMetaById}
          onOpenSettingsSection={onOpenSettingsSection}
        />

        <div className="settings-page__main">
          <div className="settings-page__header sphd">
            <button
              type="button"
              className="settings-page__back"
              onClick={onBack}
              aria-label={ti('settings.page.back')}
              title={ti('settings.page.back')}
            >
              <PetControlIcon name="back" />
              <span>{ti('settings.page.back')}</span>
            </button>

            <div className="settings-page__headline sph">
              {activeSectionMeta.eyebrow && activeSectionMeta.eyebrow !== activeSectionLabel ? (
                <p className="eyebrow">{activeSectionMeta.eyebrow}</p>
              ) : null}
              <h4 ref={activeSectionHeadingRef} tabIndex={-1}>{activeSectionLabel}</h4>
              {activeSectionDescription ? (
                <p className="settings-section__note">{activeSectionDescription}</p>
              ) : null}
            </div>

            <span className="settings-page__mark" aria-hidden="true">
              {renderSettingsCardIcon(activeSectionMeta.glyph)}
            </span>
          </div>

          <div className="settings-drawer__content sdc settings-drawer__sections" ref={sectionsRef}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
