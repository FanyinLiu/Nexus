import { PORTRAIT_DRAFT_EXPORT_LIMITS } from '../../shared/portraitDraftExport.js'
import type { PortraitDraftFlowState } from '../features/pet/portraitDraftFlow.ts'
import { SettingsV3Field, SettingsV3Notice, SettingsV3Toolbar } from '../features/settingsV3/SettingsV3Primitives.tsx'
import { pickTranslatedUiText } from '../lib/uiLanguage.ts'
import type { TranslationKey, UiLanguage } from '../types/i18n.ts'

export function PortraitDraftExport({ state, language, busy, onNameChange, onAttributionChange, onExport }: {
  state: Pick<PortraitDraftFlowState, 'exportName' | 'exportAttribution' | 'exporting' | 'exportNotice'>
  language: UiLanguage
  busy: boolean
  onNameChange: (value: string) => void
  onAttributionChange: (value: string) => void
  onExport: (defaultName: string) => Promise<void>
}) {
  const t = (key: TranslationKey) => pickTranslatedUiText(language, key)
  return (
    <section className="settings-v3-studio-pane" data-testid="portrait-export-panel" aria-label={t('settings.chat.portrait_flow.export_title')}>
      <header><strong>{t('settings.chat.portrait_flow.export_title')}</strong><span>{t('settings.chat.portrait_flow.export_hint')}</span></header>
      <SettingsV3Field label={t('settings.chat.portrait_flow.export_name')}>
        <input type="text" data-testid="portrait-export-name" value={state.exportName} maxLength={PORTRAIT_DRAFT_EXPORT_LIMITS.displayNameChars} disabled={busy} autoComplete="off" onChange={(event) => onNameChange(event.target.value)} />
      </SettingsV3Field>
      <SettingsV3Field label={t('settings.chat.portrait_flow.export_attribution')} hint={t('settings.chat.portrait_flow.export_attribution_hint')}>
        <textarea data-testid="portrait-export-attribution" value={state.exportAttribution} rows={3} maxLength={PORTRAIT_DRAFT_EXPORT_LIMITS.attributionChars} disabled={busy} autoComplete="off" spellCheck={false} onChange={(event) => onAttributionChange(event.target.value)} />
      </SettingsV3Field>
      <SettingsV3Toolbar><button type="button" data-testid="portrait-draft-export" disabled={busy} onClick={() => void onExport(t('settings.chat.portrait_flow.export_name_default'))}>{t(state.exporting ? 'settings.chat.portrait_flow.exporting' : 'settings.chat.portrait_flow.export_title')}</button></SettingsV3Toolbar>
      {state.exportNotice ? <div data-testid="portrait-export-result"><SettingsV3Notice announce tone={state.exportNotice.error ? 'error' : 'info'} title={t(state.exportNotice.key)} /></div> : null}
    </section>
  )
}
