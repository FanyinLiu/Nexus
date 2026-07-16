export const SETTINGS_STYLE_BUNDLES = [
  { id: 'foundation', load: () => import('./settingsStylesFoundation') },
  { id: 'theme', load: () => import('./settingsStylesTheme') },
  { id: 'surface', load: () => import('./settingsStylesSurface') },
  { id: 'final', load: () => import('./settingsStylesFinal') },
] as const

export async function loadSettingsStyleBundles() {
  for (const bundle of SETTINGS_STYLE_BUNDLES) {
    await bundle.load()
  }
}
