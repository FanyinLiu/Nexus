import type { WindowView } from '../../types'
import {
  isSettingsSectionId,
  normalizeSettingsSectionId,
  type SettingsSectionId,
} from '../../components/settingsDrawerSupport.ts'
import {
  getInitialPanelSection,
  getInitialSettingsSectionId,
} from '../appSupport.ts'

export function getInitialPreferredSettingsSectionId(): SettingsSectionId | null {
  const sectionId = getInitialSettingsSectionId()
  return isSettingsSectionId(sectionId) ? normalizeSettingsSectionId(sectionId) : null
}

export function shouldOpenInitialSettingsPanel(view: WindowView): boolean {
  return view === 'panel' && getInitialPanelSection() === 'settings'
}
