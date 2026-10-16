import type { KeyboardEventHandler, ReactNode, RefObject } from 'react'
import { SettingsShellV2, type SettingsV2Destination, type SettingsV2Group } from '../features/uiV2/SettingsShellV2.tsx'
import {
  SETTINGS_SIMPLE_PAGE_SECTIONS,
  settingsPageForSection,
  type SettingsSimplePageId,
} from '../features/settingsSimplify/index.ts'
import type { AppSettings, Translator } from '../types/index.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { settingsSimpleGroupCopy } from './settingsSimple/settingsSimpleCopy.ts'
import type { ConfirmOptions } from './useConfirm.ts'
import type { SettingsSectionId } from './settingsDrawerSupport.ts'

const SETTINGS_V2_DEFAULT_SECTION: Record<SettingsSimplePageId, SettingsSectionId> = {
  appearance: SETTINGS_SIMPLE_PAGE_SECTIONS.appearance[0],
  voice: SETTINGS_SIMPLE_PAGE_SECTIONS.voice[0],
  memory: SETTINGS_SIMPLE_PAGE_SECTIONS.memory[0],
  connect: SETTINGS_SIMPLE_PAGE_SECTIONS.connect[0],
  about: SETTINGS_SIMPLE_PAGE_SECTIONS.about[0],
}

function getSettingsV2Destination(sectionId: SettingsSectionId): Exclude<SettingsV2Destination, 'home'> {
  return settingsPageForSection(sectionId)
}

export type SettingsDrawerV2Props = {
  settingsView: 'home' | 'section'
  activeSectionId: SettingsSectionId
  settingsBackdropClassName: string
  settingsDrawerClassName: string
  settingsDialogRef: RefObject<HTMLElement | null>
  settingsSectionsRef: RefObject<HTMLDivElement | null>
  activeSectionHeadingRef: RefObject<HTMLHeadingElement | null>
  onDialogKeyDown: KeyboardEventHandler<HTMLElement>
  companionName: string
  draft: AppSettings
  dirty: boolean
  saving: boolean
  ti: Translator
  renderPage: () => ReactNode
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
  settingsBackdropClassName,
  settingsDrawerClassName,
  settingsDialogRef,
  settingsSectionsRef,
  activeSectionHeadingRef,
  onDialogKeyDown,
  companionName,
  draft,
  dirty,
  saving,
  ti,
  renderPage,
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
  const settingsV2Groups: readonly SettingsV2Group[] = settingsSimpleGroupCopy(draft)

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
          activeHeadingRef={activeSectionHeadingRef}
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
          <div className="settings-drawer__content settings-drawer__sections" ref={settingsSectionsRef}>
            {renderPage()}
          </div>
        </SettingsShellV2>
      </aside>
      <ConfirmDialog options={confirmOptions} onConfirm={onConfirm} onCancel={onCancel} />
    </div>
  )
}
