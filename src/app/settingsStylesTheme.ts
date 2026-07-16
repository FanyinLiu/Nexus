import './styles/settings-themes.css'

if (new URLSearchParams(window.location.search).get('uiV2') === '0') {
  await import('./settingsStylesThemeLegacy')
}

await import('./settingsStylesThemeAligned')
