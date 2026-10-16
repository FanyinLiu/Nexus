/**
 * The five settings pages. Inner tabs are gone; each page owns one
 * advanced disclosure that still mounts the older sections.
 */

export type SettingsSimplePageId = 'appearance' | 'voice' | 'memory' | 'connect' | 'about'

export const SETTINGS_SIMPLE_PAGE_SECTIONS = {
  appearance: ['chat', 'letters', 'window', 'autonomy'],
  voice: ['voice'],
  memory: ['memory', 'lorebooks'],
  connect: ['model', 'integrations', 'tools'],
  about: ['history', 'console'],
} as const

const PAGE_IDS = Object.keys(SETTINGS_SIMPLE_PAGE_SECTIONS) as SettingsSimplePageId[]

/** Page that should open when an older section id is requested. */
export function settingsPageForSection(sectionId: string): SettingsSimplePageId {
  for (const pageId of PAGE_IDS) {
    const sections: readonly string[] = SETTINGS_SIMPLE_PAGE_SECTIONS[pageId]
    if (sections.includes(sectionId)) return pageId
  }
  return 'appearance'
}
