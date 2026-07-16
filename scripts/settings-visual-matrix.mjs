export const SETTINGS_VISUAL_THEMES = [
  { id: 'system-dark', label: 'night' },
  { id: 'system-black', label: 'black' },
  { id: 'system-day', label: 'day' },
  { id: 'warm-day', label: 'warm-day' },
]

export const SETTINGS_VISUAL_SECTIONS = [
  { id: 'home', query: {} },
  { id: 'console', query: { settingsSection: 'console' } },
  { id: 'history', query: { settingsSection: 'history' } },
  { id: 'model', query: { settingsSection: 'model' } },
  { id: 'chat', query: { settingsSection: 'chat' } },
  { id: 'letters', query: { settingsSection: 'letters' } },
  { id: 'voice', query: { settingsSection: 'voice' } },
  { id: 'memory', query: { settingsSection: 'memory' } },
  { id: 'lorebooks', query: { settingsSection: 'lorebooks' } },
  { id: 'window', query: { settingsSection: 'window' } },
  { id: 'integrations', query: { settingsSection: 'integrations' } },
  { id: 'tools', query: { settingsSection: 'tools' } },
  { id: 'autonomy', query: { settingsSection: 'autonomy' } },
]

export const SETTINGS_VISUAL_VIEWPORTS = [
  { id: 'desktop', width: 1280, height: 860 },
  { id: 'desktop-720', width: 720, height: 640 },
  { id: 'portrait', width: 282, height: 662 },
  { id: 'short', width: 300, height: 480 },
  { id: 'narrow', width: 390, height: 760 },
]

export const SETTINGS_VISUAL_PRIMARY_LOCALE = 'zh-CN'
export const SETTINGS_VISUAL_LOCALES = [
  SETTINGS_VISUAL_PRIMARY_LOCALE,
  'en-US',
  'zh-TW',
  'ja',
  'ko',
]

export const SETTINGS_VISUAL_DEFAULT_LANGUAGE_CASES = [
  {
    id: SETTINGS_VISUAL_PRIMARY_LOCALE,
    sections: SETTINGS_VISUAL_SECTIONS,
    themes: SETTINGS_VISUAL_THEMES,
    viewports: SETTINGS_VISUAL_VIEWPORTS,
  },
  ...SETTINGS_VISUAL_LOCALES.filter((id) => id !== SETTINGS_VISUAL_PRIMARY_LOCALE).map((id) => ({
    id,
    sections: SETTINGS_VISUAL_SECTIONS,
    themes: SETTINGS_VISUAL_THEMES.filter((theme) => theme.id === 'warm-day'),
    viewports: SETTINGS_VISUAL_VIEWPORTS.filter((viewport) => viewport.id === 'narrow'),
  })),
]

function selectById(items, requested) {
  if (!requested.length) return items
  return items.filter((item) => requested.includes(item.id) || requested.includes(item.label))
}

function assertKnownFilter(items, requested, label) {
  const known = new Set(items.flatMap((item) => [item.id, item.label].filter(Boolean)))
  const unknown = requested.filter((id) => !known.has(id))
  if (unknown.length) throw new Error(`Unknown ${label}: ${unknown.join(', ')}`)
}

export function resolveSettingsVisualLanguageCases(options = {}) {
  const filters = {
    quick: Boolean(options.quick),
    sections: options.sections ?? [],
    locales: options.locales ?? [],
    themes: options.themes ?? [],
    viewports: options.viewports ?? [],
  }

  assertKnownFilter(SETTINGS_VISUAL_SECTIONS, filters.sections, 'section')
  assertKnownFilter(SETTINGS_VISUAL_LOCALES.map((id) => ({ id })), filters.locales, 'locale')
  assertKnownFilter(SETTINGS_VISUAL_THEMES, filters.themes, 'theme')
  assertKnownFilter(SETTINGS_VISUAL_VIEWPORTS, filters.viewports, 'viewport')

  if (filters.quick) {
    return [{
      id: SETTINGS_VISUAL_PRIMARY_LOCALE,
      sections: SETTINGS_VISUAL_SECTIONS,
      themes: SETTINGS_VISUAL_THEMES.filter((theme) => theme.id === 'warm-day'),
      viewports: SETTINGS_VISUAL_VIEWPORTS.filter((viewport) => ['desktop-720', 'short'].includes(viewport.id)),
    }]
  }

  const hasExplicitMatrixFilter = Boolean(
    filters.locales.length || filters.themes.length || filters.viewports.length,
  )
  if (!hasExplicitMatrixFilter) {
    return SETTINGS_VISUAL_DEFAULT_LANGUAGE_CASES.map((languageCase) => ({
      ...languageCase,
      sections: selectById(languageCase.sections, filters.sections),
    }))
  }

  const locales = filters.locales.length
    ? SETTINGS_VISUAL_LOCALES.filter((id) => filters.locales.includes(id))
    : SETTINGS_VISUAL_LOCALES
  const sections = selectById(SETTINGS_VISUAL_SECTIONS, filters.sections)
  const themes = selectById(SETTINGS_VISUAL_THEMES, filters.themes)
  const viewports = selectById(SETTINGS_VISUAL_VIEWPORTS, filters.viewports)

  return locales.map((id) => ({ id, sections, themes, viewports }))
}
