import { loadSettingsStyleBundles } from './settingsStyleBundles.ts'

await loadSettingsStyleBundles()

if (new URLSearchParams(window.location.search).get('uiV2') === '0') {
  await import('./settingsStylesLegacyProductReference')
}

export { SettingsDrawer } from '../components/SettingsDrawer.tsx'
