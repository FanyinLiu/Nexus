export const BASELINE_FILES: Record<string, string> = {
  'docs/SETTINGS_SURFACE_REFERENCE_REVIEW.md': `
# Settings Surface Reference Review

Settings is a high-trust control panel. It should answer what Nexus can see, what Nexus will remember, when Nexus may act, and how users pause, revoke, disable, or clear those abilities.

| Reference | Borrow | Avoid |
| --- | --- | --- |
| LibreChat | Provider, agent, tool, file, and admin boundaries. | Platform backend. |
| Cherry Studio | Stable sections. | Provider studio. |
| AnythingLLM | Inspectable context boundaries. | Workspace dashboard. |
| shadcn/ui | Row grammar. | Demo skin. |
| Radix UI Primitives | Focus semantics. | Abstraction churn. |

## Settings Surface Contract

- Trust & Safety
- Memory & Context
- Desktop Awareness
- Permissions & Integrations
- Appearance & Interaction

\`\`\`text
settings = trust boundary map + quick control panel
\`\`\`
`,
  'docs/SETTINGS_OPTIONS_ARCHITECTURE.md': `
# Settings Options Architecture

Settings is a companion control surface, not a dashboard.

- Appearance & experience
- Companion behavior
- Memory & context
- Models & connections
- Maintenance
- history, console, onboarding
- src/components/settingsHomeArchitecture.ts
- grouped by user meaning
`,
  'src/app/settingsDrawerEntry.ts': `
import './styles/settings.css'
import './styles/settings-home.css'
import './styles/settings-themes.css'
import './styles/settings-chat-aligned.css'
import './styles/settings-chat-final.css'
import './styles/settings-chat-role-final.css'
import './styles/settings-visual-system.css'
import './styles/settings-visibility-final.css'
export { SettingsDrawer } from '../components/SettingsDrawer'
`,
  'src/components/settingsDrawerMetadata.ts': `
export const SETTINGS_TRUST_SURFACE_GROUPS = {
  trustSafety: ['console', 'history'],
  memoryContext: ['memory', 'lorebooks'],
  desktopAwareness: ['window', 'autonomy', 'voice'],
  permissionsIntegrations: ['model', 'integrations', 'tools'],
  appearanceInteraction: ['chat', 'letters'],
} as const

export function getSettingsTrustSurfaceGroupId(sectionId) {
  return SETTINGS_TRUST_SURFACE_GROUPS.appearanceInteraction.includes(sectionId)
    ? 'appearanceInteraction'
    : 'trustSafety'
}
`,
  'src/components/settingsHomeArchitecture.ts': `
export const SETTINGS_HOME_GROUPS = [
  {
    id: 'appearanceExperience',
    titleKey: 'settings.home.group.appearance_experience',
    sectionIds: ['chat', 'letters'],
  },
  {
    id: 'companionBehavior',
    titleKey: 'settings.home.group.companion_behavior',
    sectionIds: ['voice', 'window', 'autonomy'],
  },
  {
    id: 'memoryContext',
    titleKey: 'settings.home.group.memory_context',
    sectionIds: ['memory', 'lorebooks'],
  },
  {
    id: 'modelConnections',
    titleKey: 'settings.home.group.model_connections',
    sectionIds: ['model', 'integrations', 'tools'],
  },
  {
    id: 'maintenance',
    titleKey: 'settings.home.group.maintenance',
    sectionIds: ['history', 'console'],
    actions: [{ actionId: 'onboarding' }],
  },
]
export const SETTINGS_HOME_SECTION_ORDER = SETTINGS_HOME_GROUPS.flatMap((group) => group.sectionIds)
export function compareSettingsHomeSections() {}
`,
  'src/components/SettingsDrawer.tsx': `
import { getSettingsTrustSurfaceGroupId } from './settingsDrawerMetadata.ts'
import { SettingsHomeView } from './SettingsHomeView.tsx'

export function SettingsDrawer() {
  const card = { trustGroup: getSettingsTrustSurfaceGroupId(section.id) }
  const settingsHomeGroups = []
  const settingsDrawerClassName = 'settings-drawer--light-section settings-drawer--warm-section settings-drawer--day-section'
  function handleOpenSettingsHomeAction() {}
  return <SettingsHomeView groups={settingsHomeGroups} onOpenHomeAction={handleOpenSettingsHomeAction} />
}
`,
  'src/components/SettingsHomeView.tsx': `
import { SettingsHomePresence } from './SettingsHomePresence.tsx'

export type SettingsHomeViewProps = {}
export function SettingsHomeView() {
  function renderSettingsAppearanceSwitch() {}
  function renderSettingsHomeAction() {}
  return <section className="settings-home"><button data-trust-group="appearanceInteraction" /><button data-trust-group={card.trustGroup} onClick={() => onOpenSettingsSection(card.sectionId)} /><button data-trust-group={action.trustGroup} onClick={() => onOpenHomeAction(action)} /><SettingsHomePresence badge="Nexus settings" title="Settings center" body="Manage settings." /><section className="settings-home-group" data-settings-home-group={group.id}><div className="settings-home-group__head" /><div className="settings-home-group__list" /></section></section>
}
`,
  'src/components/SettingsHomePresence.tsx': `
type SettingsHomePresenceProps = { badge: string; title: string; body: string }
export function SettingsHomePresence({ badge, title, body }: SettingsHomePresenceProps) {
  return <section className="settings-home-presence" aria-labelledby="settings-home-presence-title"><span className="settings-home-presence__icon"><PetControlIcon name="settings" /></span><span className="settings-home-presence__badge">{badge}</span><strong id="settings-home-presence-title">{title}</strong><span className="settings-home-presence__body">{body}</span></section>
}
`,
  'src/components/SettingsDrawerActiveSection.tsx': `
export function SettingsDrawerActiveSection({ confirm }) {
  return (
    <>
      <HistorySection
        confirm={confirm}
        onExportChatHistory={() => void chatHistory.handleExportChatHistory()}
        onClearChatHistory={() => void chatHistory.handleClearChatHistory()}
      />
      <MemorySection
        memoryFocus={memoryFocus}
        onExportMemoryArchive={() => void memoryArchive.handleExportMemoryArchive()}
        onClearMemoryArchive={() => void memoryArchive.handleClearMemoryArchive()}
        onSetMemoryEnabled={onSetMemoryEnabled}
        onRemoveMemory={onRemoveMemory}
        onClearDailyMemory={onClearDailyMemory}
        onRemoveDailyEntry={onRemoveDailyEntry}
      />
      <IntegrationsSection />
      <ToolsSection />
      <AutonomySection />
      <WindowSection />
      <ModelSection />
      <ConsoleSection />
    </>
  )
}
`,
  'src/components/settingsSections/ToolsSection.tsx': `
export function ToolsSection({ draft }) {
  const webSearchApiKeyInputValue = displaySecretInputValue(draft.toolWebSearchApiKey)
  return (
    <>
      <ToggleField field="toolWebSearchEnabled" />
      <ToggleField field="toolWeatherEnabled" />
      <ToggleField field="toolOpenExternalEnabled" />
      <ToggleField field="toolOpenExternalRequiresConfirmation" disabled={!draft.toolOpenExternalEnabled} />
      <select disabled={!draft.toolWebSearchEnabled} />
      <input value={webSearchApiKeyInputValue} disabled={!draft.toolWebSearchEnabled || !webSearchProvider.requiresApiKey} />
      <input disabled={!draft.toolWeatherEnabled} />
    </>
  )
}
`,
  'src/app/styles/settings.css': `
:root {
  --settings-control-height: 26px;
  --settings-body-font-size: 10px;
}
.settings-drawer {
  width: min(300px, calc(100vw - 18px));
  max-height: min(470px, calc(100vh - 18px));
}
`,
  'src/app/styles/settings-home.css': `
.settings-home-card:focus-visible {}
.settings-appearance-switch__option:focus-visible {}
.settings-drawer .settings-home-card {
  --settings-trust-trace: currentColor;
  border-left-color: var(--settings-trust-trace);
}
.settings-drawer .settings-home-card[data-trust-group='trustSafety'] {}
.settings-drawer .settings-home-card[data-trust-group='memoryContext'] {}
.settings-drawer .settings-home-card[data-trust-group='desktopAwareness'] {}
.settings-drawer .settings-home-card[data-trust-group='permissionsIntegrations'] {}
.settings-drawer .settings-home-card[data-trust-group='appearanceInteraction'] {}
.settings-home-group {}
.settings-home-group__head {}
.settings-home-group__title {}
.settings-home-group__hint {}
.settings-home-group__list {}
.settings-home-card--action {}
`,
  'src/app/styles/settings-themes.css': `
.settings-page__back:focus-visible {}
`,
  'src/app/styles/settings-chat-aligned.css': `
.settings-drawer--warm-day.settings-drawer--home {
  --settings-control-height: 26px;
  --settings-home-row-trace: rgba(75, 62, 49, 0.08);
  --settings-home-row-glyph: rgba(78, 64, 54, 0.32);
  --settings-surface: rgba(255, 250, 242, 0.985);
  width: min(340px, calc(100vw - 28px));
  background:
    radial-gradient(circle at 50% 2%, rgba(255, 244, 226, 0.34), transparent 42%),
    linear-gradient(180deg, rgba(255, 250, 242, 0.985), rgba(246, 236, 222, 0.975));
}
.settings-drawer--warm-day.settings-drawer--home .settings-drawer__header {
  border-bottom: 1px solid rgba(75, 62, 49, 0.08);
  background: transparent;
}
.settings-drawer--warm-day.settings-drawer--home .settings-drawer__window-title {
  letter-spacing: 0;
}
.settings-drawer--warm-day.settings-drawer--home .settings-drawer__window-title-label {
  color: rgba(36, 27, 22, 0.78);
}
.settings-drawer--warm-day.settings-drawer--home .settings-drawer__toolbar {
  padding: 0;
}
.settings-drawer--warm-day.settings-drawer--home .settings-drawer__icon-button {
  width: var(--settings-control-height-small);
  height: var(--settings-control-height-small);
  border: 1px solid transparent;
  background: transparent;
}
.settings-drawer--warm-day.settings-drawer--home .settings-drawer__icon-button svg {
  width: 12px;
}
.settings-drawer--warm-day.settings-drawer--home .settings-drawer__icon-button:hover {
  background: rgba(75, 62, 49, 0.055);
}
.settings-drawer--warm-day.settings-drawer--home .settings-appearance-switch {
  min-height: var(--settings-control-height);
  background: rgba(255, 253, 249, 0.16);
}
.settings-drawer--warm-day.settings-drawer--home .settings-appearance-switch__option.is-active {
  border-color: transparent;
  background: rgba(185, 92, 60, 0.09);
  box-shadow: inset 0 0 0 1px rgba(185, 92, 60, 0.1);
}
.settings-drawer--warm-day.settings-drawer--home .settings-home-card {
  border-left: 2px solid var(--settings-home-row-trace);
  background: rgba(255, 253, 249, 0.12);
}
.settings-drawer--warm-day.settings-drawer--home .settings-home-card__glyph {
  color: var(--settings-home-row-glyph);
}
.settings-drawer--warm-day.settings-drawer--home .settings-drawer__actions {
  grid-template-columns: minmax(82px, 0.76fr) minmax(0, 1.24fr);
  --settings-action-control-height: 21px;
  border-top: 1px solid rgba(75, 62, 49, 0.08);
  box-shadow: none;
}
.settings-drawer--warm-day.settings-drawer--home .settings-drawer__actions .ghost-button {
  border-color: transparent;
  background: transparent;
}
.settings-drawer--warm-day.settings-drawer--home .settings-drawer__actions .primary-button {
  background: rgba(185, 92, 60, 0.095);
}
.settings-drawer--warm-day.settings-drawer--section {
  --settings-child-control-height: 21px;
  --settings-child-field-height: 21px;
}
.settings-drawer--warm-section .settings-drawer__content.settings-drawer__sections {}
.settings-drawer--warm-section .settings-section {
  background: transparent;
}
.settings-drawer--warm-section .settings-model-source-card {}
.settings-drawer--warm-section .settings-model-source-card.is-selected {
  background: rgba(185, 92, 60, 0.08);
  box-shadow: inset 0 0 0 1px rgba(185, 92, 60, 0.1);
}
.settings-drawer--warm-section .settings-page[data-section='window'] label.settings-window-field {
  grid-template-columns: minmax(82px, 0.42fr) minmax(0, 1fr);
  background: rgba(255, 253, 249, 0.14);
}
.settings-drawer--warm-section .settings-page[data-section='window'] label.settings-window-field > span {
  white-space: nowrap;
}
.settings-drawer--warm-section .settings-page[data-section='window'] label.settings-window-field > select {
  min-height: var(--settings-control-height-small);
  background: transparent;
}
.settings-drawer--warm-section input:not([type='checkbox']):not([type='radio']):not([type='range']) {
  border-radius: 10px;
  background: rgba(255, 253, 249, 0.34);
}
.settings-drawer--warm-section .settings-control-card {
  background: rgba(255, 253, 249, 0.18);
}
.settings-drawer--warm-section .onboarding-relationship__chip {}
.settings-drawer--warm-section .settings-toggle:not(.settings-lorebook-check) {}
.settings-drawer--warm-section .settings-control-card:has(> .settings-toggle input:disabled) {
  background: rgba(255, 253, 249, 0.16);
}
.settings-drawer--warm-section .settings-toggle input:checked {
  background: rgba(185, 92, 60, 0.18);
}
.settings-drawer--warm-section .settings-metric-card {}
.settings-drawer--warm-section .settings-history-empty {}
.settings-drawer--warm-section .settings-letter-empty {}
.settings-drawer--warm-section .settings-action-row {}
.settings-drawer--warm-section .settings-action-row button:disabled {}
.settings-drawer--warm-section .settings-autonomy-channel__badge {}
.settings-drawer--warm-section .settings-updater-panel {}
.settings-drawer--warm-section .settings-page__back span {}
.settings-drawer--warm-day.settings-drawer--section .settings-drawer__actions {
  grid-template-columns: minmax(82px, 0.76fr) minmax(0, 1.24fr);
  --settings-action-control-height: 21px;
  border-top: 1px solid rgba(75, 62, 49, 0.08);
  box-shadow: none;
}
.settings-drawer--warm-day.settings-drawer--section .settings-drawer__actions .ghost-button {
  border-color: transparent;
  background: transparent;
}
.settings-drawer--warm-day.settings-drawer--section .settings-drawer__actions .primary-button {
  background: rgba(185, 92, 60, 0.095);
}
html[data-theme='warm-day'] .settings-drawer--warm-day.settings-drawer--home .settings-drawer__actions .primary-button {}
`,
  'src/app/styles/settings-chat-final.css': `
/* Final chat-parity pass: settings borrows the chat surface's light command rhythm. */
.settings-drawer.settings-drawer--light.settings-drawer--home,
.settings-drawer.settings-drawer--light.settings-drawer--section {
  height: min(640px, calc(100vh - 48px));
  grid-template-rows: auto minmax(0, 1fr) auto;
}
.settings-drawer.settings-drawer--light.settings-drawer--home .settings-drawer__body {}
.settings-drawer.settings-drawer--light.settings-drawer--home .settings-drawer__window-title-name {}
.settings-drawer.settings-drawer--light.settings-drawer--home .settings-drawer__window-title-label {}
.settings-drawer.settings-drawer--light.settings-drawer--home .settings-drawer__header {}
.settings-drawer.settings-drawer--light.settings-drawer--home .settings-drawer__header-main {}
.settings-drawer.settings-drawer--light.settings-drawer--home .settings-drawer__toolbar {}
.settings-drawer.settings-drawer--light.settings-drawer--home .settings-home {
  gap: 2px;
}
.settings-drawer.settings-drawer--light.settings-drawer--home .settings-home-group {}
.settings-drawer.settings-drawer--light.settings-drawer--home .settings-home-group__head {}
.settings-drawer.settings-drawer--light.settings-drawer--home .settings-home-group__title {}
.settings-drawer.settings-drawer--light.settings-drawer--home .settings-home-group__hint {}
.settings-drawer.settings-drawer--light.settings-drawer--home .settings-home-group__list {}
.settings-drawer.settings-drawer--light-section .settings-control-card {}
.settings-drawer.settings-drawer--light-section .settings-form-row {}
.settings-drawer.settings-drawer--light-section .settings-drawer__content.settings-drawer__sections {}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='model'] .onboarding-region-tabs {}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='model'] .onboarding-region-tabs__tab {}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='model'] .onboarding-region-tabs__tab.is-active {}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='model'] .settings-model-source-grid {
  grid-template-columns: 1fr;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='model'] .settings-model-source-card {
  grid-template-columns: 20px minmax(0, 1fr) 14px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='model'] .settings-model-source-card__logoFallback {
  width: 18px;
  font-size: 8px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='model'] .settings-model-source-card__meta {
  grid-row: 2;
  font-size: 10px;
  color: rgba(78, 64, 54, 0.5);
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='model'] .settings-model-source-card__chevron {
  grid-column: 3;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='model'] .settings-model-detail-card {
  padding: 0 0 8px;
  border-radius: 0;
  background: transparent;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='model'] .settings-model-detail-brand {
  display: grid;
  border: 0;
  box-shadow: none;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='model'] .settings-model-detail-nav .ghost-button {
  min-height: 28px;
  background: transparent;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='model'] .settings-model-detail-fields {
  border-top: 0;
  border-radius: 0;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='model'] .settings-model-detail-card__logoFallback {
  padding: 0;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='model'] .settings-model-detail-fields > label {
  grid-template-columns: minmax(92px, 0.32fr) minmax(0, 1fr);
  min-height: 42px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='model'] .settings-model-detail-fields > label > :is(input:not([type='checkbox']):not([type='range']), select, .settings-url-input) {
  height: 32px;
  line-height: 30px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='model'] .settings-model-advanced > summary {}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='tools'] .settings-tools-section > .settings-control-grid {}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='tools'] .settings-tools-section > .settings-control-grid > .settings-control-card {
  min-height: 36px;
}
.settings-drawer.settings-drawer--light-section .settings-page:is([data-section='tools'], [data-section='window']) label:is(.settings-tools-field, .settings-window-field) {
  grid-template-columns: minmax(84px, 0.38fr) minmax(0, 1fr);
  min-height: 40px;
}
.settings-drawer.settings-drawer--light-section .settings-page:is([data-section='tools'], [data-section='window']) label:is(.settings-tools-field, .settings-window-field) > select {
  height: 30px;
  text-align: right;
}
.settings-drawer.settings-drawer--light-section .settings-page__headline h4:focus {
  outline: none;
}
/* Tools permissions use disabled fields as readable status, not empty form holes. */
.settings-drawer.settings-drawer--light-section .settings-page[data-section='tools'] .settings-mini-group {
  grid-template-columns: 1fr;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='tools'] label.settings-tools-field > :is(input, select, .settings-url-input) {
  min-height: 30px;
  background: rgba(255, 253, 249, 0.2);
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='tools'] .settings-tools-section .settings-mini-group > label.settings-tools-field > :is(input, select, .settings-url-input):not([type='checkbox']):not([type='range']) {
  min-height: 30px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='tools'] label.settings-tools-field > :is(input, select, .settings-url-input):disabled {
  background: transparent;
  -webkit-text-fill-color: rgba(78, 64, 54, 0.58);
  opacity: 1;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='tools'] label.settings-tools-field > :is(input, .settings-url-input)::placeholder {
  -webkit-text-fill-color: rgba(78, 64, 54, 0.46);
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='tools'] .settings-tools-section > .settings-mini-group:has(> .settings-tools-control) > .settings-tools-control {
  padding: 0 6px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='tools'] .settings-tools-control > .settings-toggle {
  min-height: 30px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='console'] .settings-section > .settings-console-grid {
  border-top: 1px solid var(--settings-chat-parity-line);
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='console'] .settings-section > .settings-console-grid > .settings-console-card {
  min-height: 58px;
  border-bottom: 1px solid var(--settings-chat-parity-line);
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='console'] .settings-console-badge {
  font-size: 10px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='console'] .settings-console-card__headline {
  grid-template-columns: minmax(0, 1fr) minmax(72px, auto);
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='console'] .settings-console-card p {
  -webkit-line-clamp: 1;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='console'] .settings-console-sections {
  margin-top: 6px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='console'] details.settings-console-section {
  background: transparent;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='console'] details.settings-console-section > summary.settings-console-section__header {
  grid-template-columns: minmax(0, 1fr) minmax(36px, auto) 14px;
  min-height: 48px;
  border-radius: 0;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='console'] details.settings-console-section > summary.settings-console-section__header p {
  -webkit-line-clamp: 2;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='console'] details.settings-console-section > summary.settings-console-section__header .settings-console-section__meta {
  min-height: 24px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='console'] .settings-console-sections > section.settings-console-section {
  border-radius: 0;
  box-shadow: none;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='console'] .settings-console-sections > section.settings-console-section .settings-console-grid--spaced {
  gap: 0;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='console'] .settings-console-sections > section.settings-console-section .settings-console-card {
  min-height: 48px;
  background: transparent;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='history'] .settings-history-summary-grid {
  grid-template-columns: 1fr;
  border-top: 1px solid var(--settings-chat-parity-line);
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='history'] .settings-history-summary-grid .settings-metric-card {
  grid-template-columns: minmax(0, 1fr) minmax(52px, auto);
  border-bottom: 1px solid var(--settings-chat-parity-line);
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='history'] .settings-history-note {
  -webkit-line-clamp: 2;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='history'] .settings-history-actions {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='history'] .settings-history-actions > button {
  min-height: 30px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='history'] .settings-history-actions .settings-history-clear-button {
  grid-column: 1 / -1;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='history'] .settings-history-empty {
  min-height: 36px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='letters'] .settings-letter-section {
  gap: 6px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='letters'] .settings-letter-group {
  gap: 5px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='letters'] .settings-letter-empty {
  min-height: 54px;
  border-top: 1px solid var(--settings-chat-parity-line);
  border-bottom: 1px solid var(--settings-chat-parity-line);
  border-radius: 0;
  background: transparent;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='letters'] .settings-letter-empty strong {
  white-space: nowrap;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='letters'] .settings-letter-empty__label {
  -webkit-line-clamp: 2;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='lorebooks'] .settings-lorebook-list {
  border-top: 1px solid var(--settings-chat-parity-line);
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='lorebooks'] .settings-lorebook-item {
  border-bottom: 1px solid var(--settings-chat-parity-line);
  background: transparent;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='lorebooks'] .settings-lorebook-item__toolbar {
  grid-template-areas:
    "label label label"
    "enabled priority delete";
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='lorebooks'] .settings-lorebook-title-field,
.settings-drawer.settings-drawer--light-section .settings-page[data-section='lorebooks'] .settings-lorebook-keywords-field {
  min-height: 40px;
  border-bottom: 1px solid var(--settings-chat-parity-line);
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='lorebooks'] .settings-lorebook-check {
  grid-template-columns: minmax(0, 1fr) 44px;
  min-height: 30px;
  gap: 4px;
  padding: 0 6px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='lorebooks'] .settings-lorebook-priority {
  grid-template-columns: minmax(70px, 1fr) 50px;
  gap: 0;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='lorebooks'] .settings-lorebook-priority > input:not([type='checkbox']):not([type='range']) {
  min-width: 0;
  height: 30px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='lorebooks'] .settings-lorebook-section__actions .ghost-button {
  min-height: 30px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='lorebooks'] .settings-lorebook-content-field > textarea {
  height: 76px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='lorebooks'] .settings-lorebook-empty {
  min-height: 36px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='autonomy'] .settings-autonomy-group {}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='autonomy'] .settings-drawer__card {
  border-bottom: 1px solid var(--settings-chat-parity-line);
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='autonomy'] .settings-drawer__card .settings-page__meta {}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='autonomy'] .settings-drawer__card .settings-page__meta > span {}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='autonomy'] .settings-drawer__card > .settings-toggle {
  border-top: 1px solid var(--settings-chat-parity-line);
}
.settings-drawer.settings-drawer--light-section .settings-choice-card.is-active {}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='memory'] .settings-memory-context-status-grid {}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='memory'] .settings-memory-context-status {}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='memory'] .settings-control-card.settings-memory-context-status {}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='memory'] .settings-control-card.settings-memory-context-status:not(.settings-metric-card):not(.settings-updater-panel) {}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='memory'] .settings-memory-context-status__head {}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='memory'] .settings-memory-context-status__head span {}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='memory'] .settings-memory-context-status.is-active .settings-memory-context-status__head span {}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='memory'] .settings-memory-context-status.is-unavailable {}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='memory'] .settings-memory-context-transparency__rows {}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='memory'] .settings-memory-context-transparency__row {}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='memory'] .settings-memory-context-actions .ghost-button,
.settings-drawer.settings-drawer--light-section .settings-page[data-section='memory'] .settings-memory-archive-actions .ghost-button,
.settings-drawer.settings-drawer--light-section .settings-page[data-section='memory'] .memory-card__actions .ghost-button {
  min-height: 30px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='memory'] .settings-memory-group > .settings-memory-field > .settings-form-row > input:not([type='checkbox']):not([type='radio']):not([type='range']) {}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='memory'] .settings-memory-recall-grid input:not([type='checkbox']):not([type='range']) {
  height: 30px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='memory'] .settings-memory-group > label.settings-memory-field > select {
  min-height: 32px;
  height: 32px;
  line-height: 30px;
  padding: 0 34px 0 8px;
}
.settings-drawer.settings-drawer--light-section .settings-toggle input:checked {
  background: linear-gradient(135deg, rgba(199, 102, 69, 0.82), rgba(224, 148, 93, 0.72));
}
.settings-drawer--warm-day.settings-drawer--home,
.settings-drawer--warm-day.settings-drawer--section {
  --settings-surface: #fffaf3;
  --settings-chat-parity-line: rgba(75, 62, 49, 0.065);
  --settings-chat-parity-row: rgba(255, 253, 249, 0.08);
  --settings-chat-parity-command: rgba(185, 92, 60, 0.062);
  --settings-control-font-size: 10px;
  --settings-meta-font-size: 9px;
  width: min(340px, calc(100vw - 28px));
  height: min(640px, calc(100vh - 48px));
  position: relative;
  isolation: isolate;
  background-color: #fffaf3;
  background-image: linear-gradient(180deg, #fffaf3 0%, #f6ecde 100%);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
.settings-backdrop.settings-backdrop--light:has(.settings-drawer--home) {
  background: rgba(241, 229, 211, 0.55);
}
.settings-drawer.settings-drawer--light.settings-drawer--home::before {
  z-index: 0;
}
.settings-drawer.settings-drawer--light.settings-drawer--home > * {
  z-index: 1;
}
.settings-drawer--warm-day.settings-drawer--home .settings-drawer__window-title-name,
.settings-drawer--warm-day.settings-drawer--section .settings-drawer__window-title-name {
  display: inline;
  font-weight: 620;
}
.settings-drawer--warm-day.settings-drawer--home .settings-drawer__window-title-label,
.settings-drawer--warm-day.settings-drawer--section .settings-drawer__window-title-label {
  clip-path: inset(50%);
  white-space: nowrap;
}
.settings-drawer--warm-day.settings-drawer--home .settings-drawer__window-title-label::before,
.settings-drawer--warm-day.settings-drawer--section .settings-drawer__window-title-label::before {
  content: none;
}
.settings-drawer--warm-day.settings-drawer--home .settings-drawer__header,
.settings-drawer--warm-day.settings-drawer--section .settings-drawer__header {
  border-bottom: 1px solid transparent;
  border-radius: 0;
  box-shadow: none;
}
.settings-drawer--warm-day.settings-drawer--home .settings-drawer__header-main,
.settings-drawer--warm-day.settings-drawer--section .settings-drawer__header-main {
  min-height: 28px;
  border: 0;
  background: transparent;
}
.settings-drawer--warm-day.settings-drawer--home .settings-drawer__toolbar,
.settings-drawer--warm-day.settings-drawer--section .settings-drawer__toolbar {
  padding: 0;
  border-radius: 0;
  background: transparent;
}
.settings-drawer--warm-day.settings-drawer--home .settings-drawer__icon-button,
.settings-drawer--warm-day.settings-drawer--section .settings-drawer__icon-button {
  width: 20px;
  height: 20px;
  border-radius: 6px;
}
.settings-drawer--warm-day.settings-drawer--home .settings-home {
  gap: 3px;
}
.settings-drawer--warm-day.settings-drawer--home .settings-home-group {}
.settings-drawer--warm-day.settings-drawer--home .settings-home-group__head {}
.settings-drawer--warm-day.settings-drawer--home .settings-home-group__title {}
.settings-drawer--warm-day.settings-drawer--home .settings-home-group__hint {}
.settings-drawer--warm-day.settings-drawer--home .settings-home-group__list {}
.settings-drawer--warm-day.settings-drawer--home .settings-home-card {
  grid-template-columns: 18px minmax(0, 1fr) minmax(68px, min(48%, 176px));
  min-height: 38px;
  background: transparent;
}
.settings-drawer.settings-drawer--light.settings-drawer--home .settings-home-card__label {
  grid-column: 2;
}
.settings-drawer.settings-drawer--light.settings-drawer--home .settings-home-card__value {
  grid-column: 3;
  color: rgba(78, 64, 54, 0.66);
}
.settings-drawer.settings-drawer--light.settings-drawer--home .settings-home-card__glyph {
  grid-column: 1;
  justify-self: center;
  opacity: 0.62;
}
.settings-drawer--warm-section .settings-control-card,
.settings-drawer--warm-section .settings-form-row {
  border-color: var(--settings-chat-parity-line);
  background: var(--settings-chat-parity-row);
}
.settings-drawer--warm-section input:not([type='checkbox']):not([type='radio']):not([type='range']) {
  background: rgba(255, 253, 249, 0.18);
}
.settings-drawer--warm-section .settings-drawer__content.settings-drawer__sections {
  padding-bottom: 104px;
  scroll-padding-bottom: 90px;
  mask-image: linear-gradient(180deg, #000 0, #000 calc(100% - 22px), transparent 100%);
}
.settings-drawer--warm-section .settings-page[data-section='model'] .onboarding-region-tabs {
  gap: 2px;
  border: 1px solid var(--settings-chat-parity-line);
  border-radius: 9px;
}
.settings-drawer--warm-section .settings-page[data-section='model'] .onboarding-region-tabs__tab {
  min-height: 30px;
  border-radius: 7px;
}
.settings-drawer--warm-section .settings-page[data-section='model'] .onboarding-region-tabs__tab.is-active {
  box-shadow: inset 0 0 0 1px rgba(185, 92, 60, 0.1);
}
.settings-drawer--warm-section .settings-page[data-section='model'] .settings-model-source-grid {
  gap: 4px;
}
.settings-drawer--warm-section .settings-control-card:not(.settings-metric-card):not(.settings-updater-panel) {
  border-radius: 8px;
}
.settings-drawer--warm-section .settings-choice-card.is-active {
  box-shadow: inset 0 0 0 1px rgba(185, 92, 60, 0.1);
}
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-chat-identity-field > .settings-form-row {
  grid-template-columns: minmax(70px, 0.36fr) minmax(0, 1fr);
}
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-chat-relationship-card {
  border-bottom-color: var(--settings-chat-parity-line);
  background: var(--settings-chat-parity-row);
}
.settings-drawer.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-chat-relationship-card {
  border-bottom-color: var(--settings-chat-parity-line);
}
.settings-drawer.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-chat-relationship-card > .settings-mini-group__head:not(summary) {
  min-height: auto;
}
.settings-drawer--warm-section .settings-page[data-section='chat'] .onboarding-relationship__options {
  border: 1px solid rgba(75, 62, 49, 0.045);
  gap: 1px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-radius: 8px;
}
.settings-drawer--warm-section .settings-page[data-section='chat'] .onboarding-relationship__chip.is-active {
  box-shadow: inset 0 0 0 1px rgba(185, 92, 60, 0.07);
}
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-pet-model-card,
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-pet-preview-card,
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-pet-workflow-card {
  background: rgba(255, 253, 249, 0.1);
}
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-pet-model-card {
  padding: 0 0 6px;
}
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-pet-model-card > .settings-mini-group__head > span {
  display: -webkit-box;
  white-space: normal;
  -webkit-line-clamp: 2;
}
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-pet-model-card .settings-choice-grid {
  border: 1px solid var(--settings-chat-parity-line);
}
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-pet-model-card .settings-choice-card {
  grid-template-columns: minmax(78px, 0.34fr) minmax(0, 1fr);
  min-height: 46px;
}
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-pet-model-card .settings-choice-card__description {
  color: rgba(78, 64, 54, 0.62);
  text-align: left;
  -webkit-line-clamp: 2;
}
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-pet-preview-card {
  padding: 0 0 8px;
  border-bottom-color: var(--settings-chat-parity-line);
}
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-sprite-preview__stage {
  min-height: 118px;
}
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-sprite-preview__states button,
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-companion-state-preview__states button {
  min-height: 28px;
}
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-pet-action-row {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
}
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-pet-tools > .settings-mini-group__note {
  -webkit-line-clamp: 3;
}
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-pet-workflow-grid {
  gap: 8px;
}
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-pet-workflow-card {
  padding: 0 0 8px;
  border-bottom-color: var(--settings-chat-parity-line);
}
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-community-links {
  display: flex;
  flex-wrap: wrap;
}
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-community-links a {
  flex: 1 1 132px;
  min-height: 28px;
}
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-community-links__text {
  white-space: normal;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='memory'] .settings-memory-transparency__grid {
  grid-template-columns: 1fr;
  gap: 0;
  border-top: 1px solid var(--settings-chat-parity-line);
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='memory'] .settings-control-card.settings-memory-transparency__card:not(.settings-metric-card):not(.settings-updater-panel) {
  grid-template-columns: minmax(72px, 0.28fr) minmax(0, 1fr);
  min-height: 36px;
}
.settings-drawer--warm-section .settings-page[data-section='memory'] .settings-memory-context-status-grid {
  border-top: 1px solid var(--settings-chat-parity-line);
}
.settings-drawer--warm-section .settings-page[data-section='memory'] .settings-memory-context-status {
  grid-template-rows: auto auto;
  min-height: 44px;
}
.settings-drawer--warm-section .settings-page[data-section='memory'] .settings-control-card.settings-memory-context-status {
  min-height: 44px;
}
.settings-drawer--warm-section .settings-page[data-section='memory'] .settings-control-card.settings-memory-context-status:not(.settings-metric-card):not(.settings-updater-panel) {
  min-height: 44px;
}
.settings-drawer--warm-section .settings-page[data-section='memory'] .settings-memory-context-status__head {
  grid-template-columns: minmax(0, 1fr) minmax(42px, auto);
}
.settings-drawer--warm-section .settings-page[data-section='memory'] .settings-memory-context-status__head span {
  min-width: 42px;
}
.settings-drawer--warm-section .settings-page[data-section='memory'] .settings-memory-context-status.is-active .settings-memory-context-status__head span {
  background: rgba(82, 136, 118, 0.08);
}
.settings-drawer--warm-section .settings-page[data-section='memory'] .settings-memory-context-status.is-unavailable {
  opacity: 1;
}
.settings-drawer--warm-section .settings-page[data-section='memory'] .settings-memory-context-transparency__rows {
  border-top: 1px solid var(--settings-chat-parity-line);
}
.settings-drawer--warm-section .settings-page[data-section='memory'] .settings-memory-context-transparency__row {
  grid-template-columns: minmax(80px, 0.33fr) minmax(0, 1fr);
  border-bottom: 1px solid var(--settings-chat-parity-line);
}
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-mini-group:has(> .settings-chat-system-prompt) {
  border-bottom: 1px solid var(--settings-chat-parity-line);
}
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-mini-group:not(.settings-pet-model-card):not(.settings-pet-preview-card):not(.settings-pet-workflow-card):has(> .settings-chat-system-prompt):has(> .settings-control-card) {
  border: 0;
}
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-chat-system-prompt {
  height: 68px;
  min-height: 58px;
  max-height: 72px;
  border-color: rgba(75, 62, 49, 0.045);
  background: rgba(255, 253, 249, 0.14);
}
.settings-drawer--warm-section .settings-page[data-section='chat'] .settings-mini-group:has(> .settings-chat-system-prompt) .settings-chat-advanced-control > .settings-toggle {
  min-height: 28px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='voice'] .settings-mini-group__head span {
  color: rgba(78, 64, 54, 0.58);
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='voice'] .settings-voice-loop-card > label.settings-voice-field {
  min-height: 58px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='voice'] .settings-voice-loop-card > label.settings-voice-field > select {
  height: 34px;
  padding: 0 28px 0 10px;
  color: rgba(36, 27, 22, 0.84);
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='voice'] .settings-voice-loop-card > label.settings-control-card.settings-voice-field:not(.settings-metric-card):not(.settings-updater-panel) {
  grid-template-columns: minmax(108px, 0.36fr) minmax(0, 1fr);
  min-height: 44px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='voice'] .settings-voice-loop-card > label.settings-control-card.settings-voice-field:not(.settings-metric-card):not(.settings-updater-panel) > span {
  white-space: nowrap;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='voice'] .settings-voice-loop-card > label.settings-control-card.settings-voice-field:not(.settings-metric-card):not(.settings-updater-panel) > select {
  height: 34px;
  line-height: 1.2;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='voice'] .settings-speech-config-section > .settings-section__title-row {
  grid-template-columns: minmax(0, 1fr) minmax(96px, auto);
  grid-template-rows: auto auto;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='voice'] .settings-speech-config-section > .settings-section__title-row > div {
  display: contents;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='voice'] .settings-speech-config-section > .settings-section__title-row .settings-drawer__hint {
  grid-column: 1 / -1;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='voice'] .settings-speech-config-section > .settings-section__title-row > .ghost-button {
  min-width: 96px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='voice'] .settings-speech-preview-button {
  min-height: 30px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='voice'] .settings-speech-config-section > label.settings-control-card.settings-speech-config-field:not(:has(> textarea)):not(:has(> .settings-drawer__hint)):not(.settings-metric-card):not(.settings-updater-panel) {
  grid-template-columns: minmax(108px, 0.36fr) minmax(0, 1fr);
  align-items: center;
  min-height: 44px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='voice'] .settings-speech-config-section > label.settings-control-card.settings-speech-config-field:not(:has(> textarea)):not(:has(> .settings-drawer__hint)):not(.settings-metric-card):not(.settings-updater-panel) > :is(input:not([type='checkbox']):not([type='range']), select, .settings-url-input) {
  height: 34px;
  line-height: 1.2;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='voice'] .settings-speech-config-section > .settings-speech-config-note {
  border-bottom: 1px solid var(--settings-chat-parity-line);
  -webkit-line-clamp: 3;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='voice'] .settings-tts-tuning__item {
  padding: 6px 2px 7px;
  border-bottom: 1px solid var(--settings-chat-parity-line);
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='voice'] .settings-tts-tuning__controls {
  grid-template-columns: minmax(0, 1fr) 72px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='voice'] input.settings-tts-tuning__number:not([type='checkbox']):not([type='range']) {
  height: 30px;
}
.settings-drawer.settings-drawer--light-section .settings-updater-panel__actions .ghost-button,
.settings-drawer.settings-drawer--light-section .settings-updater-panel__actions .primary-button {
  min-height: 30px;
}
.settings-drawer--warm-day.settings-drawer--home .settings-drawer__actions,
.settings-drawer--warm-day.settings-drawer--section .settings-drawer__actions {
  justify-content: flex-end;
  gap: 8px;
  min-height: 31px;
}
.settings-drawer--warm-day.settings-drawer--home .settings-drawer__actions .primary-button,
.settings-drawer--warm-day.settings-drawer--section .settings-drawer__actions .primary-button {
  min-height: 30px;
  min-width: 112px;
  -webkit-backdrop-filter: none;
  background: var(--settings-chat-parity-command);
}
`,
  'src/app/styles/settings-chat-role-final.css': `
/* Chat-section parity pass: role, companion preview, and pet workflow settings. */
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-chat-identity-field > .settings-form-row {
  grid-template-columns: minmax(70px, 0.36fr) minmax(0, 1fr);
  min-height: 30px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-chat-identity-field > .settings-form-row > input:not([type='checkbox']):not([type='radio']):not([type='range']) {
  height: 30px;
  border-color: rgba(75, 62, 49, 0.045);
  background: rgba(255, 253, 249, 0.16);
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-mini-group:has(> .settings-chat-system-prompt) {
  border-bottom: 1px solid var(--settings-chat-parity-line);
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-mini-group:not(.settings-pet-model-card):not(.settings-pet-preview-card):not(.settings-pet-workflow-card):has(> .settings-chat-system-prompt):has(> .settings-control-card) {
  border: 0;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-chat-system-prompt {
  height: 68px;
  min-height: 58px;
  max-height: 72px;
  border-color: rgba(75, 62, 49, 0.045);
  background: rgba(255, 253, 249, 0.14);
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-mini-group:has(> .settings-chat-system-prompt) .settings-chat-advanced-control > .settings-toggle {
  min-height: 28px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-chat-relationship-card,
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-chat-relationship-card {
  border-bottom-color: var(--settings-chat-parity-line);
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-chat-relationship-card > .settings-mini-group__head:not(summary) {
  min-height: auto;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .onboarding-relationship__options {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  border: 1px solid rgba(75, 62, 49, 0.045);
  border-radius: 8px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .onboarding-relationship__chip.is-active {
  box-shadow: inset 0 0 0 1px rgba(185, 92, 60, 0.07);
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-pet-model-card,
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-pet-preview-card,
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-pet-workflow-card {
  background: rgba(255, 253, 249, 0.1);
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-pet-model-card {
  padding: 0 0 6px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-pet-model-card > .settings-mini-group__head > span {
  display: -webkit-box;
  white-space: normal;
  -webkit-line-clamp: 2;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-pet-model-card .settings-choice-grid {
  border: 1px solid var(--settings-chat-parity-line);
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-pet-model-card .settings-choice-card {
  grid-template-columns: minmax(78px, 0.34fr) minmax(0, 1fr);
  min-height: 46px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-pet-model-card .settings-choice-card__description {
  color: rgba(78, 64, 54, 0.62);
  text-align: left;
  -webkit-line-clamp: 2;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-pet-preview-card {
  padding: 0 0 8px;
  border-bottom-color: var(--settings-chat-parity-line);
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-sprite-preview__stage {
  min-height: 118px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-sprite-preview__states button,
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-companion-state-preview__states button {
  min-height: 28px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-pet-action-row {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-pet-action-row .ghost-button {
  min-height: 30px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-pet-tools > .settings-mini-group__note {
  -webkit-line-clamp: 3;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-pet-workflow-grid {}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-pet-workflow-card {}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-pet-workflow-card > .settings-inline-row:not(.settings-pet-creator-actions) input {
  height: 30px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-community-links {
  display: flex;
  flex-wrap: wrap;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-community-links a {
  flex: 1 1 132px;
  min-height: 28px;
}
.settings-drawer.settings-drawer--light-section .settings-page[data-section='chat'] .settings-community-links__text {
  white-space: normal;
}
`,
  'src/app/styles/settings-visual-system.css': `
/* Nexus settings visual system. */
.settings-backdrop,
.settings-drawer {
  --nx-settings-control-height: 30px;
  --nx-settings-segment-height: 28px;
  --nx-settings-footer-height: 36px;
  --nx-settings-field-height: 32px;
  --nx-settings-icon-size: 18px;
  --nx-settings-track-trust: rgba(220, 116, 87, 0.86);
  --nx-settings-track-memory: rgba(90, 164, 76, 0.86);
  --nx-settings-track-desktop: rgba(52, 124, 210, 0.86);
  --nx-settings-track-permission: rgba(135, 82, 207, 0.82);
  --nx-settings-track-appearance: rgba(215, 124, 45, 0.9);
}
.settings-backdrop--night,
.settings-drawer--night {
  --nx-settings-segment-surface: rgba(255, 255, 255, 0.055);
  --nx-settings-segment-active: rgba(255, 255, 255, 0.14);
  --nx-settings-footer-surface: linear-gradient(to bottom, rgba(14, 18, 28, 0), rgba(14, 18, 28, 0.96) 42%);
}
.settings-backdrop--day,
.settings-drawer--day {
  --nx-settings-segment-surface: rgba(56, 65, 78, 0.055);
  --nx-settings-segment-active: rgba(255, 255, 255, 0.86);
  --nx-settings-footer-surface: linear-gradient(to bottom, rgba(250, 252, 255, 0), rgba(250, 252, 255, 0.98) 42%);
}
.settings-backdrop--warm-day,
.settings-drawer--warm-day {
  --nx-settings-segment-surface: rgba(78, 62, 46, 0.055);
  --nx-settings-segment-active: rgba(255, 253, 249, 0.78);
  --nx-settings-footer-surface: linear-gradient(to bottom, rgba(255, 250, 243, 0), rgba(255, 250, 243, 0.99) 42%);
}
.settings-drawer.settings-drawer--section .settings-page[data-section] {
  --settings-child-control-height: var(--nx-settings-control-height);
}
.settings-drawer.settings-drawer--section .settings-page[data-section] :is(input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='file']), select, textarea, .settings-url-input) {
  min-height: var(--nx-settings-field-height);
}
.settings-drawer.settings-drawer--section .settings-page[data-section] :is(.settings-form-row__validation, .settings-model-advanced__error, .settings-test-result.is-error, .settings-url-input--invalid) {
  border-color: color-mix(in srgb, var(--nx-settings-danger) 38%, var(--nx-settings-line));
}
.settings-drawer.settings-drawer--section .settings-page[data-section] .settings-toggle input:checked {
  background: linear-gradient(135deg, var(--nx-settings-accent), white);
}
.settings-drawer.settings-drawer--section .settings-page[data-section] :is(.onboarding-region-tabs, .onboarding-relationship__options, .settings-sprite-preview__states, .settings-companion-state-preview__states) {
  background: var(--nx-settings-segment-surface);
}
.settings-drawer.settings-drawer--section .settings-page[data-section] .settings-choice-card.is-active {
  background: var(--nx-settings-accent-soft);
}
.settings-drawer.settings-drawer--section .settings-page[data-section] .settings-danger-button {
  color: var(--nx-settings-danger);
}
.settings-backdrop .confirm-dialog-card {
  background: var(--nx-settings-surface);
}
.settings-backdrop .confirm-dialog-card__confirm.is-danger {
  background: var(--nx-settings-danger);
}
`,
  'src/app/styles/settings-visibility-final.css': `
/* Settings visibility final layer. This file intentionally loads last. */
/* ImageGen concept pass: warm settings home as a flat command list. */
.settings-drawer.settings-drawer--light.settings-drawer--home {
  --settings-concept-ink: rgba(31, 27, 23, 0.92); --settings-concept-line-soft: rgba(78, 62, 46, 0.075);
  width: min(340px, calc(100vw - 28px)); height: min(720px, calc(100vh - 42px));
}
.settings-drawer.settings-drawer--light.settings-drawer--home .settings-home-card[data-trust-group='trustSafety'] { --settings-trust-trace: rgba(220, 116, 87, 0.86); }
.settings-drawer.settings-drawer--light.settings-drawer--home .settings-appearance-switch { border-bottom: 1px solid var(--settings-concept-line-soft); }
/* v0.4.2 settings child-page unity pass. */
.settings-drawer.settings-drawer--section .settings-page[data-section] .settings-page__header { min-height: 48px; border-bottom: 1px solid var(--nx-settings-line-soft); }
.settings-drawer.settings-drawer--section .settings-page[data-section] .settings-page__back { width: var(--nx-settings-control-height-small); }
.settings-drawer.settings-drawer--section .settings-page[data-section] .settings-page__headline h4 { font-size: 13px; }
.settings-drawer.settings-drawer--section .settings-page[data-section] :is(.settings-section, .settings-mini-group, .settings-drawer__card, .settings-speech-config-section) {}
.settings-drawer.settings-drawer--section .settings-drawer__actions { background: var(--nx-settings-footer-surface); }
`,
}
