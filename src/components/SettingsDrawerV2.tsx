import type { KeyboardEventHandler, ReactNode, RefObject } from 'react'
import { SettingsShellV2, type SettingsV2Destination, type SettingsV2Group } from '../features/uiV2/SettingsShellV2.tsx'
import { getSettingsV2NavigationIntent } from '../features/uiV2/settingsNavigationIntent.ts'
import { getSettingsTabScrollLeft } from '../features/uiV2/settingsTabScroll.ts'
import type { Translator } from '../types/index.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import type { ConfirmOptions } from './useConfirm.ts'
import type { SettingsSectionId } from './settingsDrawerSupport.ts'

type SettingsSectionOption = {
  id: SettingsSectionId
  label: string
}

const SETTINGS_V2_SECTIONS: Record<Exclude<SettingsV2Destination, 'home'>, readonly SettingsSectionId[]> = {
  companion: ['chat', 'letters', 'window', 'autonomy'],
  voice: ['voice'],
  privacy: ['memory', 'lorebooks'],
  advanced: ['model', 'integrations', 'tools', 'history', 'console'],
}

const SETTINGS_V2_DEFAULT_SECTION: Record<Exclude<SettingsV2Destination, 'home'>, SettingsSectionId> = {
  companion: 'chat',
  voice: 'voice',
  privacy: 'memory',
  advanced: 'model',
}

function getSettingsV2Destination(sectionId: SettingsSectionId): Exclude<SettingsV2Destination, 'home'> {
  for (const [destination, sectionIds] of Object.entries(SETTINGS_V2_SECTIONS)) {
    if (sectionIds.includes(sectionId)) {
      return destination as Exclude<SettingsV2Destination, 'home'>
    }
  }
  return 'companion'
}

export type SettingsDrawerV2Props = {
  settingsView: 'home' | 'section'
  activeSectionId: SettingsSectionId
  activeSectionLabel: string
  activeSectionDescription: string
  voiceSectionDescription: string
  settingsSectionOptions: readonly SettingsSectionOption[]
  settingsBackdropClassName: string
  settingsDrawerClassName: string
  settingsDialogRef: RefObject<HTMLElement | null>
  settingsSectionsRef: RefObject<HTMLDivElement | null>
  activeSectionHeadingRef: RefObject<HTMLHeadingElement | null>
  onDialogKeyDown: KeyboardEventHandler<HTMLElement>
  companionName: string
  dirty: boolean
  saving: boolean
  ti: Translator
  renderActiveSettingsSection: () => ReactNode
  confirmOptions: ConfirmOptions | null
  onReturnToSettingsHome: (moveFocus?: boolean) => void
  onOpenSettingsSection: (sectionId: SettingsSectionId, moveFocus?: boolean) => void
  onClose: () => void
  onDiscardDraft: () => void
  onSaveDraft: () => void | Promise<void>
  onConfirm: () => void
  onCancel: () => void
}

export function SettingsDrawerV2({
  settingsView,
  activeSectionId,
  activeSectionLabel,
  activeSectionDescription,
  voiceSectionDescription,
  settingsSectionOptions,
  settingsBackdropClassName,
  settingsDrawerClassName,
  settingsDialogRef,
  settingsSectionsRef,
  activeSectionHeadingRef,
  onDialogKeyDown,
  companionName,
  dirty,
  saving,
  ti,
  renderActiveSettingsSection,
  confirmOptions,
  onReturnToSettingsHome,
  onOpenSettingsSection,
  onClose,
  onDiscardDraft,
  onSaveDraft,
  onConfirm,
  onCancel,
}: SettingsDrawerV2Props) {
  const activeDestination: SettingsV2Destination = settingsView === 'home'
    ? 'home'
    : getSettingsV2Destination(activeSectionId)
  const settingsV2Groups: readonly SettingsV2Group[] = [
    {
      id: 'companion',
      label: ti('ui_v2.settings.companion'),
      description: ti('ui_v2.settings.companion_hint'),
      icon: 'chat',
    },
    {
      id: 'voice',
      label: ti('settings.section.voice'),
      description: voiceSectionDescription,
      icon: 'voice',
    },
    {
      id: 'privacy',
      label: ti('ui_v2.settings.privacy'),
      description: ti('ui_v2.settings.privacy_hint'),
      icon: 'memory',
    },
    {
      id: 'advanced',
      label: ti('ui_v2.settings.advanced'),
      description: ti('ui_v2.settings.advanced_hint'),
      icon: 'model',
    },
  ]
  const activeV2Sections = activeDestination === 'home'
    ? []
    : SETTINGS_V2_SECTIONS[activeDestination]

  return (
    <div className={`${settingsBackdropClassName} settings-backdrop--v2`} onClick={onClose}>
      <aside
        ref={settingsDialogRef}
        className={`${settingsDrawerClassName} settings-drawer--v2`}
        role="dialog"
        aria-modal="true"
        aria-label={ti('settings.panel', { name: companionName })}
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
        onClick={(event) => event.stopPropagation()}
      >
        <SettingsShellV2
          activeDestination={activeDestination}
          groups={settingsV2Groups}
          labels={{
            settings: ti('settings.title'),
            home: ti('settings.title'),
            backToSettings: ti('settings.page.back'),
            returnToCompanion: ti('settings.return_to_companion'),
            closeSettings: ti('common.close'),
            unsavedChanges: ti('settings.unsaved_changes'),
            cancel: ti('common.cancel'),
            save: ti('settings.save'),
            saving: ti('settings.autonomy.notifications.saving'),
            navigationLabel: ti('settings.title'),
          }}
          dirty={dirty}
          saving={saving}
          activeHeadingRef={activeV2Sections.length === 1 ? activeSectionHeadingRef : undefined}
          onNavigate={(destination, intent) => {
            if (destination === 'home') {
              onReturnToSettingsHome(false)
              return
            }
            onOpenSettingsSection(SETTINGS_V2_DEFAULT_SECTION[destination], intent.moveFocus)
          }}
          onClose={onClose}
          onDiscardDraft={onDiscardDraft}
          onSaveDraft={onSaveDraft}
        >
          {activeV2Sections.length > 1 ? <nav className="settings-v2__section-tabs" aria-label={activeSectionLabel}>
            {settingsSectionOptions
              .filter((section) => activeV2Sections.includes(section.id))
              .map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className={section.id === activeSectionId ? 'is-active' : ''}
                  aria-current={section.id === activeSectionId ? 'page' : undefined}
                  ref={(node) => {
                    if (!node || section.id !== activeSectionId) return
                    const tabs = node.parentElement
                    if (!(tabs instanceof HTMLElement)) return
                    const tabsRect = tabs.getBoundingClientRect()
                    const tabRect = node.getBoundingClientRect()
                    const nextScrollLeft = getSettingsTabScrollLeft({
                      navScrollLeft: tabs.scrollLeft,
                      navClientWidth: tabs.clientWidth,
                      tabOffsetLeft: tabRect.left - tabsRect.left + tabs.scrollLeft,
                      tabWidth: tabRect.width,
                    })
                    if (nextScrollLeft !== tabs.scrollLeft) tabs.scrollLeft = nextScrollLeft
                  }}
                  onClick={(event) => {
                    const intent = getSettingsV2NavigationIntent(event.detail)
                    onOpenSettingsSection(section.id, intent.moveFocus)
                  }}
                >
                  {section.label}
                </button>
              ))}
          </nav> : null}
          <div className="settings-v2__active-section">
            {activeV2Sections.length > 1 ? <header className="settings-v2__active-heading">
              <h2 ref={activeSectionHeadingRef} tabIndex={-1}>{activeSectionLabel}</h2>
              {activeSectionDescription ? <p>{activeSectionDescription}</p> : null}
            </header> : null}
            <div className="settings-drawer__content settings-drawer__sections" ref={settingsSectionsRef}>
              {renderActiveSettingsSection()}
            </div>
          </div>
        </SettingsShellV2>
      </aside>
      <ConfirmDialog options={confirmOptions} onConfirm={onConfirm} onCancel={onCancel} />
    </div>
  )
}
