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

## v0.4.2 Settings Visual System Contract

The settings UI uses one Nexus grammar across warm white, black-white/day, and night tones. The shared visual-system layer must cover child pages, dialogs, fields, toggles, segmented controls, footer actions, error/validation states, active choices, and destructive actions. The goal is practical consistency: opening any settings page should feel like the same product, with the same row height logic, radius, icon scale, control density, focus behavior, disabled behavior, and save/cancel footer rhythm.
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
import './styles/settings-product-reference-final.css'
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
.sd {
  width: min(300px, calc(100vw - 18px));
  max-height: min(470px, calc(100vh - 18px));
}
`,
  'src/app/styles/settings-home.css': `
.settings-home-card:focus-visible {}
.settings-appearance-switch__option:focus-visible {}
.sd .settings-home-card {
  --settings-trust-trace: currentColor;
  border-left-color: var(--settings-trust-trace);
}
.sd .settings-home-card[data-trust-group='trustSafety'] {}
.sd .settings-home-card[data-trust-group='memoryContext'] {}
.sd .settings-home-card[data-trust-group='desktopAwareness'] {}
.sd .settings-home-card[data-trust-group='permissionsIntegrations'] {}
.sd .settings-home-card[data-trust-group='appearanceInteraction'] {}
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
.sd-warm.sd-home {
  --settings-control-height: 26px;
  --settings-home-row-trace: rgba(75, 62, 49, 0.08);
  --settings-home-row-glyph: rgba(78, 64, 54, 0.32);
  --settings-surface: rgba(255, 250, 242, 0.985);
  width: min(340px, calc(100vw - 28px));
  background:
    radial-gradient(circle at 50% 2%, rgba(255, 244, 226, 0.34), transparent 42%),
    linear-gradient(180deg, rgba(255, 250, 242, 0.985), rgba(246, 236, 222, 0.975));
}
.sd-warm.sd-home .sdh {
  border-bottom: 1px solid rgba(75, 62, 49, 0.08);
  background: transparent;
}
.sd-warm.sd-home .settings-drawer__window-title {
  letter-spacing: 0;
}
.sd-warm.sd-home .settings-drawer__window-title-label {
  color: rgba(36, 27, 22, 0.78);
}
.sd-warm.sd-home .sdtb {
  padding: 0;
}
.sd-warm.sd-home .settings-drawer__icon-button {
  width: var(--settings-control-height-small);
  height: var(--settings-control-height-small);
  border: 1px solid transparent;
  background: transparent;
}
.sd-warm.sd-home .settings-drawer__icon-button svg {
  width: 12px;
}
.sd-warm.sd-home .settings-drawer__icon-button:hover {
  background: rgba(75, 62, 49, 0.055);
}
.sd-warm.sd-home .settings-appearance-switch {
  min-height: var(--settings-control-height);
  background: rgba(255, 253, 249, 0.16);
}
.sd-warm.sd-home .settings-appearance-switch__option.is-active {
  border-color: transparent;
  background: rgba(185, 92, 60, 0.09);
  box-shadow: inset 0 0 0 1px rgba(185, 92, 60, 0.1);
}
.sd-warm.sd-home .settings-home-card {
  border-left: 2px solid var(--settings-home-row-trace);
  background: rgba(255, 253, 249, 0.12);
}
.sd-warm.sd-home .settings-home-card__glyph {
  color: var(--settings-home-row-glyph);
}
.sd-warm.sd-home .sda {
  grid-template-columns: minmax(82px, 0.76fr) minmax(0, 1.24fr);
  --settings-action-control-height: 21px;
  border-top: 1px solid rgba(75, 62, 49, 0.08);
  box-shadow: none;
}
.sd-warm.sd-home .sda .ghost-button {
  border-color: transparent;
  background: transparent;
}
.sd-warm.sd-home .sda .primary-button {
  background: rgba(185, 92, 60, 0.095);
}
.sd-warm.sd-section {
  --settings-child-control-height: 21px;
  --settings-child-field-height: 21px;
}
.sd-warm-section .sdc.settings-drawer__sections {}
.sd-warm-section .settings-section {
  background: transparent;
}
.sd-warm-section .settings-model-source-card {}
.sd-warm-section .settings-model-source-card.is-selected {
  background: rgba(185, 92, 60, 0.08);
  box-shadow: inset 0 0 0 1px rgba(185, 92, 60, 0.1);
}
.sd-warm-section .sp[data-section='window'] label.settings-window-field {
  grid-template-columns: minmax(82px, 0.42fr) minmax(0, 1fr);
  background: rgba(255, 253, 249, 0.14);
}
.sd-warm-section .sp[data-section='window'] label.settings-window-field > span {
  white-space: nowrap;
}
.sd-warm-section .sp[data-section='window'] label.settings-window-field > select {
  min-height: var(--settings-control-height-small);
  background: transparent;
}
.sd-warm-section input:not([type='checkbox']):not([type='radio']):not([type='range']) {
  border-radius: 10px;
  background: rgba(255, 253, 249, 0.34);
}
.sd-warm-section .settings-control-card {
  background: rgba(255, 253, 249, 0.18);
}
.sd-warm-section .onboarding-relationship__chip {}
.sd-warm-section .settings-toggle:not(.settings-lorebook-check) {}
.sd-warm-section .settings-control-card:has(> .settings-toggle input:disabled) {
  background: rgba(255, 253, 249, 0.16);
}
.sd-warm-section .settings-toggle input:checked {
  background: rgba(185, 92, 60, 0.18);
}
.sd-warm-section .settings-metric-card {}
.sd-warm-section .settings-history-empty {}
.sd-warm-section .settings-letter-empty {}
.sd-warm-section .settings-action-row {}
.sd-warm-section .settings-action-row button:disabled {}
.sd-warm-section .settings-autonomy-channel__badge {}
.sd-warm-section .settings-updater-panel {}
.sd-warm-section .settings-page__back span {}
.sd-warm.sd-section .sda {
  grid-template-columns: minmax(82px, 0.76fr) minmax(0, 1.24fr);
  --settings-action-control-height: 21px;
  border-top: 1px solid rgba(75, 62, 49, 0.08);
  box-shadow: none;
}
.sd-warm.sd-section .sda .ghost-button {
  border-color: transparent;
  background: transparent;
}
.sd-warm.sd-section .sda .primary-button {
  background: rgba(185, 92, 60, 0.095);
}
html[data-theme='warm-day'] .sd-warm.sd-home .sda .primary-button {}
`,
  'src/app/styles/settings-chat-final.css': `
/* Final chat-parity pass: settings borrows the chat surface's light command rhythm. */
.sd-light.sd-home,
.sd-light.sd-section {
  height: min(640px, calc(100vh - 48px));
  grid-template-rows: auto minmax(0, 1fr) auto;
}
.sd-light.sd-home .sdb {}
.sd-light.sd-home .settings-drawer__window-title-name {}
.sd-light.sd-home .settings-drawer__window-title-label {}
.sd-light.sd-home .sdh {}
.sd-light.sd-home .sdhm {}
.sd-light.sd-home .sdtb {}
.sd-light.sd-home .settings-home {
  gap: 2px;
}
.sd-light.sd-home .settings-home-group {}
.sd-light.sd-home .settings-home-group__head {}
.sd-light.sd-home .settings-home-group__title {}
.sd-light.sd-home .settings-home-group__hint {}
.sd-light.sd-home .settings-home-group__list {}
.sd-light-section .settings-control-card {}
.sd-light-section .settings-form-row {}
.sd-light-section .sdc.settings-drawer__sections {}
.sd-light-section .sp[data-section='model'] .onboarding-region-tabs {}
.sd-light-section .sp[data-section='model'] .onboarding-region-tabs__tab {}
.sd-light-section .sp[data-section='model'] .onboarding-region-tabs__tab.is-active {}
.sd-light-section .sp[data-section='model'] .settings-model-source-grid {
  grid-template-columns: 1fr;
}
.sd-light-section .sp[data-section='model'] .settings-model-source-card {
  grid-template-columns: 20px minmax(0, 1fr) 14px;
}
.sd-light-section .sp[data-section='model'] .settings-model-source-card__logoFallback {
  width: 18px;
  font-size: 8px;
}
.sd-light-section .sp[data-section='model'] .settings-model-source-card__meta {
  grid-row: 2;
  font-size: 10px;
  color: rgba(78, 64, 54, 0.5);
}
.sd-light-section .sp[data-section='model'] .settings-model-source-card__chevron {
  grid-column: 3;
}
.sd-light-section .sp[data-section='model'] .settings-model-detail-card {
  padding: 0 0 8px;
  border-radius: 0;
  background: transparent;
}
.sd-light-section .sp[data-section='model'] .settings-model-detail-brand {
  display: grid;
  border: 0;
  box-shadow: none;
}
.sd-light-section .sp[data-section='model'] .settings-model-detail-nav .ghost-button {
  min-height: 28px;
  background: transparent;
}
.sd-light-section .sp[data-section='model'] .settings-model-detail-fields {
  border-top: 0;
  border-radius: 0;
}
.sd-light-section .sp[data-section='model'] .settings-model-detail-card__logoFallback {
  padding: 0;
}
.sd-light-section .sp[data-section='model'] .settings-model-detail-fields > label {
  grid-template-columns: minmax(92px, 0.32fr) minmax(0, 1fr);
  min-height: 42px;
}
.sd-light-section .sp[data-section='model'] .settings-model-detail-fields > label > :is(input:not([type='checkbox']):not([type='range']), select, .settings-url-input) {
  height: 32px;
  line-height: 30px;
}
.sd-light-section .sp[data-section='model'] .settings-model-advanced > summary {}
.sd-light-section .sp[data-section='tools'] .settings-tools-section > .settings-control-grid {}
.sd-light-section .sp[data-section='tools'] .settings-tools-section > .settings-control-grid > .settings-control-card {
  min-height: 36px;
}
.sd-light-section .sp.sp:is([data-section='tools'], [data-section='window']) label:is(.settings-tools-field, .settings-window-field) {
  grid-template-columns: minmax(84px, 0.38fr) minmax(0, 1fr);
  min-height: 40px;
}
.sd-light-section .sp.sp:is([data-section='tools'], [data-section='window']) label:is(.settings-tools-field, .settings-window-field) > select {
  height: 30px;
  text-align: right;
}
.sd-light-section .sph h4:focus {
  outline: none;
}
/* Tools permissions use disabled fields as readable status, not empty form holes. */
.sd-light-section .sp[data-section='tools'] .settings-mini-group {
  grid-template-columns: 1fr;
}
.sd-light-section .sp[data-section='tools'] label.settings-tools-field > :is(input, select, .settings-url-input) {
  min-height: 30px;
  background: rgba(255, 253, 249, 0.2);
}
.sd-light-section .sp[data-section='tools'] .settings-tools-section .settings-mini-group > label.settings-tools-field > :is(input, select, .settings-url-input):not([type='checkbox']):not([type='range']) {
  min-height: 30px;
}
.sd-light-section .sp[data-section='tools'] label.settings-tools-field > :is(input, select, .settings-url-input):disabled {
  background: transparent;
  -webkit-text-fill-color: rgba(78, 64, 54, 0.58);
  opacity: 1;
}
.sd-light-section .sp[data-section='tools'] label.settings-tools-field > :is(input, .settings-url-input)::placeholder {
  -webkit-text-fill-color: rgba(78, 64, 54, 0.46);
}
.sd-light-section .sp[data-section='tools'] .settings-tools-section > .settings-mini-group:has(> .settings-tools-control) > .settings-tools-control {
  padding: 0 6px;
}
.sd-light-section .sp[data-section='tools'] .settings-tools-control > .settings-toggle {
  min-height: 30px;
}
.sd-light-section .sp[data-section='console'] .settings-section > .settings-console-grid {
  border-top: 1px solid var(--settings-chat-parity-line);
}
.sd-light-section .sp[data-section='console'] .settings-section > .settings-console-grid > .settings-console-card {
  min-height: 58px;
  border-bottom: 1px solid var(--settings-chat-parity-line);
}
.sd-light-section .sp[data-section='console'] .settings-console-badge {
  font-size: 10px;
}
.sd-light-section .sp[data-section='console'] .settings-console-card__headline {
  grid-template-columns: minmax(0, 1fr) minmax(72px, auto);
}
.sd-light-section .sp[data-section='console'] .settings-console-card p {
  -webkit-line-clamp: 1;
}
.sd-light-section .sp[data-section='console'] .settings-console-sections {
  margin-top: 6px;
}
.sd-light-section .sp[data-section='console'] details.settings-console-section {
  background: transparent;
}
.sd-light-section .sp[data-section='console'] details.settings-console-section > summary.settings-console-section__header {
  grid-template-columns: minmax(0, 1fr) minmax(36px, auto) 14px;
  min-height: 48px;
  border-radius: 0;
}
.sd-light-section .sp[data-section='console'] details.settings-console-section > summary.settings-console-section__header p {
  -webkit-line-clamp: 2;
}
.sd-light-section .sp[data-section='console'] details.settings-console-section > summary.settings-console-section__header .settings-console-section__meta {
  min-height: 24px;
}
.sd-light-section .sp[data-section='console'] .settings-console-sections > section.settings-console-section {
  border-radius: 0;
  box-shadow: none;
}
.sd-light-section .sp[data-section='console'] .settings-console-sections > section.settings-console-section .settings-console-grid--spaced {
  gap: 0;
}
.sd-light-section .sp[data-section='console'] .settings-console-sections > section.settings-console-section .settings-console-card {
  min-height: 48px;
  background: transparent;
}
.sd-light-section .sp[data-section='history'] .settings-history-summary-grid {
  grid-template-columns: 1fr;
  border-top: 1px solid var(--settings-chat-parity-line);
}
.sd-light-section .sp[data-section='history'] .settings-history-summary-grid .settings-metric-card {
  grid-template-columns: minmax(0, 1fr) minmax(52px, auto);
  border-bottom: 1px solid var(--settings-chat-parity-line);
}
.sd-light-section .sp[data-section='history'] .settings-history-note {
  -webkit-line-clamp: 2;
}
.sd-light-section .sp[data-section='history'] .settings-history-actions {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.sd-light-section .sp[data-section='history'] .settings-history-actions > button {
  min-height: 30px;
}
.sd-light-section .sp[data-section='history'] .settings-history-actions .settings-history-clear-button {
  grid-column: 1 / -1;
}
.sd-light-section .sp[data-section='history'] .settings-history-empty {
  min-height: 36px;
}
.sd-light-section .sp[data-section='letters'] .settings-letter-section {
  gap: 6px;
}
.sd-light-section .sp[data-section='letters'] .settings-letter-group {
  gap: 5px;
}
.sd-light-section .sp[data-section='letters'] .settings-letter-empty {
  min-height: 54px;
  border-top: 1px solid var(--settings-chat-parity-line);
  border-bottom: 1px solid var(--settings-chat-parity-line);
  border-radius: 0;
  background: transparent;
}
.sd-light-section .sp[data-section='letters'] .settings-letter-empty strong {
  white-space: nowrap;
}
.sd-light-section .sp[data-section='letters'] .settings-letter-empty__label {
  -webkit-line-clamp: 2;
}
.sd-light-section .sp[data-section='lorebooks'] .settings-lorebook-list {
  border-top: 1px solid var(--settings-chat-parity-line);
}
.sd-light-section .sp[data-section='lorebooks'] .settings-lorebook-item {
  border-bottom: 1px solid var(--settings-chat-parity-line);
  background: transparent;
}
.sd-light-section .sp[data-section='lorebooks'] .settings-lorebook-item__toolbar {
  grid-template-areas:
    "label label label"
    "enabled priority delete";
}
.sd-light-section .sp[data-section='lorebooks'] .settings-lorebook-title-field,
.sd-light-section .sp[data-section='lorebooks'] .settings-lorebook-keywords-field {
  min-height: 40px;
  border-bottom: 1px solid var(--settings-chat-parity-line);
}
.sd-light-section .sp[data-section='lorebooks'] .settings-lorebook-check {
  grid-template-columns: minmax(0, 1fr) 44px;
  min-height: 30px;
  gap: 4px;
  padding: 0 6px;
}
.sd-light-section .sp[data-section='lorebooks'] .settings-lorebook-priority {
  grid-template-columns: minmax(70px, 1fr) 50px;
  gap: 0;
}
.sd-light-section .sp[data-section='lorebooks'] .settings-lorebook-priority > input:not([type='checkbox']):not([type='range']) {
  min-width: 0;
  height: 30px;
}
.sd-light-section .sp[data-section='lorebooks'] .settings-lorebook-section__actions .ghost-button {
  min-height: 30px;
}
.sd-light-section .sp[data-section='lorebooks'] .settings-lorebook-content-field > textarea {
  height: 76px;
}
.sd-light-section .sp[data-section='lorebooks'] .settings-lorebook-empty {
  min-height: 36px;
}
.sd-light-section .sp[data-section='autonomy'] .settings-autonomy-group {}
.sd-light-section .sp[data-section='autonomy'] .settings-drawer__card {
  border-bottom: 1px solid var(--settings-chat-parity-line);
}
.sd-light-section .sp[data-section='autonomy'] .settings-drawer__card .settings-page__meta {}
.sd-light-section .sp[data-section='autonomy'] .settings-drawer__card .settings-page__meta > span {}
.sd-light-section .sp[data-section='autonomy'] .settings-drawer__card > .settings-toggle {
  border-top: 1px solid var(--settings-chat-parity-line);
}
.sd-light-section .settings-choice-card.is-active {}
.sd-light-section .sp[data-section='memory'] .settings-memory-context-status-grid {}
.sd-light-section .sp[data-section='memory'] .settings-memory-context-status {}
.sd-light-section .sp[data-section='memory'] .settings-control-card.settings-memory-context-status {}
.sd-light-section .sp[data-section='memory'] .settings-control-card.settings-memory-context-status:not(.settings-metric-card):not(.settings-updater-panel) {}
.sd-light-section .sp[data-section='memory'] .settings-memory-context-status__head {}
.sd-light-section .sp[data-section='memory'] .settings-memory-context-status__head span {}
.sd-light-section .sp[data-section='memory'] .settings-memory-context-status.is-active .settings-memory-context-status__head span {}
.sd-light-section .sp[data-section='memory'] .settings-memory-context-status.is-unavailable {}
.sd-light-section .sp[data-section='memory'] .settings-memory-context-transparency__rows {}
.sd-light-section .sp[data-section='memory'] .settings-memory-context-transparency__row {}
.sd-light-section .sp[data-section='memory'] .settings-memory-context-actions .ghost-button,
.sd-light-section .sp[data-section='memory'] .settings-memory-archive-actions .ghost-button,
.sd-light-section .sp[data-section='memory'] .memory-card__actions .ghost-button {
  min-height: 30px;
}
.sd-light-section .sp[data-section='memory'] .settings-memory-group > .settings-memory-field > .settings-form-row > input:not([type='checkbox']):not([type='radio']):not([type='range']) {}
.sd-light-section .sp[data-section='memory'] .settings-memory-recall-grid input:not([type='checkbox']):not([type='range']) {
  height: 30px;
}
.sd-light-section .sp[data-section='memory'] .settings-memory-group > label.settings-memory-field > select {
  min-height: 32px;
  height: 32px;
  line-height: 30px;
  padding: 0 34px 0 8px;
}
.sd-light-section .settings-toggle input:checked {
  background: linear-gradient(135deg, rgba(199, 102, 69, 0.82), rgba(224, 148, 93, 0.72));
}
.sd-warm.sd-home,
.sd-warm.sd-section {
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
.sd-light.sd-home::before {
  z-index: 0;
}
.sd-light.sd-home > * {
  z-index: 1;
}
.sd-warm.sd-home .settings-drawer__window-title-name,
.sd-warm.sd-section .settings-drawer__window-title-name {
  display: inline;
  font-weight: 620;
}
.sd-warm.sd-home .settings-drawer__window-title-label,
.sd-warm.sd-section .settings-drawer__window-title-label {
  clip-path: inset(50%);
  white-space: nowrap;
}
.sd-warm.sd-home .settings-drawer__window-title-label::before,
.sd-warm.sd-section .settings-drawer__window-title-label::before {
  content: none;
}
.sd-warm.sd-home .sdh,
.sd-warm.sd-section .sdh {
  border-bottom: 1px solid transparent;
  border-radius: 0;
  box-shadow: none;
}
.sd-warm.sd-home .sdhm,
.sd-warm.sd-section .sdhm {
  min-height: 28px;
  border: 0;
  background: transparent;
}
.sd-warm.sd-home .sdtb,
.sd-warm.sd-section .sdtb {
  padding: 0;
  border-radius: 0;
  background: transparent;
}
.sd-warm.sd-home .settings-drawer__icon-button,
.sd-warm.sd-section .settings-drawer__icon-button {
  width: 20px;
  height: 20px;
  border-radius: 6px;
}
.sd-warm.sd-home .settings-home {
  gap: 3px;
}
.sd-warm.sd-home .settings-home-group {}
.sd-warm.sd-home .settings-home-group__head {}
.sd-warm.sd-home .settings-home-group__title {}
.sd-warm.sd-home .settings-home-group__hint {}
.sd-warm.sd-home .settings-home-group__list {}
.sd-warm.sd-home .settings-home-card {
  grid-template-columns: 18px minmax(0, 1fr) minmax(68px, min(48%, 176px));
  min-height: 38px;
  background: transparent;
}
.sd-light.sd-home .settings-home-card__label {
  grid-column: 2;
}
.sd-light.sd-home .settings-home-card__value {
  grid-column: 3;
  color: rgba(78, 64, 54, 0.66);
}
.sd-light.sd-home .settings-home-card__glyph {
  grid-column: 1;
  justify-self: center;
  opacity: 0.62;
}
.sd-warm-section .settings-control-card,
.sd-warm-section .settings-form-row {
  border-color: var(--settings-chat-parity-line);
  background: var(--settings-chat-parity-row);
}
.sd-warm-section input:not([type='checkbox']):not([type='radio']):not([type='range']) {
  background: rgba(255, 253, 249, 0.18);
}
.sd-warm-section .sdc.settings-drawer__sections {
  padding-bottom: 104px;
  scroll-padding-bottom: 90px;
  mask-image: linear-gradient(180deg, #000 0, #000 calc(100% - 22px), transparent 100%);
}
.sd-warm-section .sp[data-section='model'] .onboarding-region-tabs {
  gap: 2px;
  border: 1px solid var(--settings-chat-parity-line);
  border-radius: 9px;
}
.sd-warm-section .sp[data-section='model'] .onboarding-region-tabs__tab {
  min-height: 30px;
  border-radius: 7px;
}
.sd-warm-section .sp[data-section='model'] .onboarding-region-tabs__tab.is-active {
  box-shadow: inset 0 0 0 1px rgba(185, 92, 60, 0.1);
}
.sd-warm-section .sp[data-section='model'] .settings-model-source-grid {
  gap: 4px;
}
.sd-warm-section .settings-control-card:not(.settings-metric-card):not(.settings-updater-panel) {
  border-radius: 8px;
}
.sd-warm-section .settings-choice-card.is-active {
  box-shadow: inset 0 0 0 1px rgba(185, 92, 60, 0.1);
}
.sd-warm-section .sp[data-section='chat'] .settings-chat-identity-field > .settings-form-row {
  grid-template-columns: minmax(70px, 0.36fr) minmax(0, 1fr);
}
.sd-warm-section .sp[data-section='chat'] .settings-chat-relationship-card {
  border-bottom-color: var(--settings-chat-parity-line);
  background: var(--settings-chat-parity-row);
}
.settings-drawer.sd-warm-section .sp[data-section='chat'] .settings-chat-relationship-card {
  border-bottom-color: var(--settings-chat-parity-line);
}
.settings-drawer.sd-warm-section .sp[data-section='chat'] .settings-chat-relationship-card > .settings-mini-group__head:not(summary) {
  min-height: auto;
}
.sd-warm-section .sp[data-section='chat'] .onboarding-relationship__options {
  border: 1px solid rgba(75, 62, 49, 0.045);
  gap: 1px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-radius: 8px;
}
.sd-warm-section .sp[data-section='chat'] .onboarding-relationship__chip.is-active {
  box-shadow: inset 0 0 0 1px rgba(185, 92, 60, 0.07);
}
.sd-warm-section .sp[data-section='chat'] .settings-pet-model-card,
.sd-warm-section .sp[data-section='chat'] .settings-pet-preview-card,
.sd-warm-section .sp[data-section='chat'] .settings-pet-workflow-card {
  background: rgba(255, 253, 249, 0.1);
}
.sd-warm-section .sp[data-section='chat'] .settings-pet-model-card {
  padding: 0 0 6px;
}
.sd-warm-section .sp[data-section='chat'] .settings-pet-model-card > .settings-mini-group__head > span {
  display: -webkit-box;
  white-space: normal;
  -webkit-line-clamp: 2;
}
.sd-warm-section .sp[data-section='chat'] .settings-pet-model-card .settings-choice-grid {
  border: 1px solid var(--settings-chat-parity-line);
}
.sd-warm-section .sp[data-section='chat'] .settings-pet-model-card .settings-choice-card {
  grid-template-columns: minmax(78px, 0.34fr) minmax(0, 1fr);
  min-height: 46px;
}
.sd-warm-section .sp[data-section='chat'] .settings-pet-model-card .settings-choice-card__description {
  color: rgba(78, 64, 54, 0.62);
  text-align: left;
  -webkit-line-clamp: 2;
}
.sd-warm-section .sp[data-section='chat'] .settings-pet-preview-card {
  padding: 0 0 8px;
  border-bottom-color: var(--settings-chat-parity-line);
}
.sd-warm-section .sp[data-section='chat'] .settings-sprite-preview__stage {
  min-height: 118px;
}
.sd-warm-section .sp[data-section='chat'] .settings-sprite-preview__states button,
.sd-warm-section .sp[data-section='chat'] .settings-companion-state-preview__states button {
  min-height: 28px;
}
.sd-warm-section .sp[data-section='chat'] .settings-pet-action-row {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
}
.sd-warm-section .sp[data-section='chat'] .settings-pet-tools > .settings-mini-group__note {
  -webkit-line-clamp: 3;
}
.sd-warm-section .sp[data-section='chat'] .settings-pet-workflow-grid {
  gap: 8px;
}
.sd-warm-section .sp[data-section='chat'] .settings-pet-workflow-card {
  padding: 0 0 8px;
  border-bottom-color: var(--settings-chat-parity-line);
}
.sd-warm-section .sp[data-section='chat'] .settings-community-links {
  display: flex;
  flex-wrap: wrap;
}
.sd-warm-section .sp[data-section='chat'] .settings-community-links a {
  flex: 1 1 132px;
  min-height: 28px;
}
.sd-warm-section .sp[data-section='chat'] .settings-community-links__text {
  white-space: normal;
}
.sd-light-section .sp[data-section='memory'] .settings-memory-transparency__grid {
  grid-template-columns: 1fr;
  gap: 0;
  border-top: 1px solid var(--settings-chat-parity-line);
}
.sd-light-section .sp[data-section='memory'] .settings-control-card.settings-memory-transparency__card:not(.settings-metric-card):not(.settings-updater-panel) {
  grid-template-columns: minmax(72px, 0.28fr) minmax(0, 1fr);
  min-height: 36px;
}
.sd-warm-section .sp[data-section='memory'] .settings-memory-context-status-grid {
  border-top: 1px solid var(--settings-chat-parity-line);
}
.sd-warm-section .sp[data-section='memory'] .settings-memory-context-status {
  grid-template-rows: auto auto;
  min-height: 44px;
}
.sd-warm-section .sp[data-section='memory'] .settings-control-card.settings-memory-context-status {
  min-height: 44px;
}
.sd-warm-section .sp[data-section='memory'] .settings-control-card.settings-memory-context-status:not(.settings-metric-card):not(.settings-updater-panel) {
  min-height: 44px;
}
.sd-warm-section .sp[data-section='memory'] .settings-memory-context-status__head {
  grid-template-columns: minmax(0, 1fr) minmax(42px, auto);
}
.sd-warm-section .sp[data-section='memory'] .settings-memory-context-status__head span {
  min-width: 42px;
}
.sd-warm-section .sp[data-section='memory'] .settings-memory-context-status.is-active .settings-memory-context-status__head span {
  background: rgba(82, 136, 118, 0.08);
}
.sd-warm-section .sp[data-section='memory'] .settings-memory-context-status.is-unavailable {
  opacity: 1;
}
.sd-warm-section .sp[data-section='memory'] .settings-memory-context-transparency__rows {
  border-top: 1px solid var(--settings-chat-parity-line);
}
.sd-warm-section .sp[data-section='memory'] .settings-memory-context-transparency__row {
  grid-template-columns: minmax(80px, 0.33fr) minmax(0, 1fr);
  border-bottom: 1px solid var(--settings-chat-parity-line);
}
.sd-warm-section .sp[data-section='chat'] .settings-mini-group:has(> .settings-chat-system-prompt) {
  border-bottom: 1px solid var(--settings-chat-parity-line);
}
.sd-warm-section .sp[data-section='chat'] .settings-mini-group:not(.settings-pet-model-card):not(.settings-pet-preview-card):not(.settings-pet-workflow-card):has(> .settings-chat-system-prompt):has(> .settings-control-card) {
  border: 0;
}
.sd-warm-section .sp[data-section='chat'] .settings-chat-system-prompt {
  height: 68px;
  min-height: 58px;
  max-height: 72px;
  border-color: rgba(75, 62, 49, 0.045);
  background: rgba(255, 253, 249, 0.14);
}
.sd-warm-section .sp[data-section='chat'] .settings-mini-group:has(> .settings-chat-system-prompt) .settings-chat-advanced-control > .settings-toggle {
  min-height: 28px;
}
.sd-light-section .sp[data-section='voice'] .settings-mini-group__head span {
  color: rgba(78, 64, 54, 0.58);
}
.sd-light-section .sp[data-section='voice'] .settings-voice-loop-card > label.settings-voice-field {
  min-height: 58px;
}
.sd-light-section .sp[data-section='voice'] .settings-voice-loop-card > label.settings-voice-field > select {
  height: 34px;
  padding: 0 28px 0 10px;
  color: rgba(36, 27, 22, 0.84);
}
.sd-light-section .sp[data-section='voice'] .settings-voice-loop-card > label.settings-control-card.settings-voice-field:not(.settings-metric-card):not(.settings-updater-panel) {
  grid-template-columns: minmax(108px, 0.36fr) minmax(0, 1fr);
  min-height: 44px;
}
.sd-light-section .sp[data-section='voice'] .settings-voice-loop-card > label.settings-control-card.settings-voice-field:not(.settings-metric-card):not(.settings-updater-panel) > span {
  white-space: nowrap;
}
.sd-light-section .sp[data-section='voice'] .settings-voice-loop-card > label.settings-control-card.settings-voice-field:not(.settings-metric-card):not(.settings-updater-panel) > select {
  height: 34px;
  line-height: 1.2;
}
.sd-light-section .sp[data-section='voice'] .settings-speech-config-section > .settings-section__title-row {
  grid-template-columns: minmax(0, 1fr) minmax(96px, auto);
  grid-template-rows: auto auto;
}
.sd-light-section .sp[data-section='voice'] .settings-speech-config-section > .settings-section__title-row > div {
  display: contents;
}
.sd-light-section .sp[data-section='voice'] .settings-speech-config-section > .settings-section__title-row .settings-drawer__hint {
  grid-column: 1 / -1;
}
.sd-light-section .sp[data-section='voice'] .settings-speech-config-section > .settings-section__title-row > .ghost-button {
  min-width: 96px;
}
.sd-light-section .sp[data-section='voice'] .settings-speech-preview-button {
  min-height: 30px;
}
.sd-light-section .sp[data-section='voice'] .settings-speech-config-section > label.settings-control-card.settings-speech-config-field:not(:has(> textarea)):not(:has(> .settings-drawer__hint)):not(.settings-metric-card):not(.settings-updater-panel) {
  grid-template-columns: minmax(108px, 0.36fr) minmax(0, 1fr);
  align-items: center;
  min-height: 44px;
}
.sd-light-section .sp[data-section='voice'] .settings-speech-config-section > label.settings-control-card.settings-speech-config-field:not(:has(> textarea)):not(:has(> .settings-drawer__hint)):not(.settings-metric-card):not(.settings-updater-panel) > :is(input:not([type='checkbox']):not([type='range']), select, .settings-url-input) {
  height: 34px;
  line-height: 1.2;
}
.sd-light-section .sp[data-section='voice'] .settings-speech-config-section > .settings-speech-config-note {
  border-bottom: 1px solid var(--settings-chat-parity-line);
  -webkit-line-clamp: 3;
}
.sd-light-section .sp[data-section='voice'] .settings-tts-tuning__item {
  padding: 6px 2px 7px;
  border-bottom: 1px solid var(--settings-chat-parity-line);
}
.sd-light-section .sp[data-section='voice'] .settings-tts-tuning__controls {
  grid-template-columns: minmax(0, 1fr) 72px;
}
.sd-light-section .sp[data-section='voice'] input.settings-tts-tuning__number:not([type='checkbox']):not([type='range']) {
  height: 30px;
}
.sd-light-section .settings-updater-panel__actions .ghost-button,
.sd-light-section .settings-updater-panel__actions .primary-button {
  min-height: 30px;
}
.sd-warm.sd-home .sda,
.sd-warm.sd-section .sda {
  justify-content: flex-end;
  gap: 8px;
  min-height: 31px;
}
.sd-warm.sd-home .sda .primary-button,
.sd-warm.sd-section .sda .primary-button {
  min-height: 30px;
  min-width: 112px;
  -webkit-backdrop-filter: none;
  background: var(--settings-chat-parity-command);
}
`,
  'src/app/styles/settings-chat-role-final.css': `
/* Chat-section parity pass: role, companion preview, and pet workflow settings. */
.sd-light-section .sp[data-section='chat'] .settings-chat-identity-field > .settings-form-row {
  grid-template-columns: minmax(70px, 0.36fr) minmax(0, 1fr);
  min-height: 30px;
}
.sd-light-section .sp[data-section='chat'] .settings-chat-identity-field > .settings-form-row > input:not([type='checkbox']):not([type='radio']):not([type='range']) {
  height: 30px;
  border-color: rgba(75, 62, 49, 0.045);
  background: rgba(255, 253, 249, 0.16);
}
.sd-light-section .sp[data-section='chat'] .settings-mini-group:has(> .settings-chat-system-prompt) {
  border-bottom: 1px solid var(--settings-chat-parity-line);
}
.sd-light-section .sp[data-section='chat'] .settings-mini-group:not(.settings-pet-model-card):not(.settings-pet-preview-card):not(.settings-pet-workflow-card):has(> .settings-chat-system-prompt):has(> .settings-control-card) {
  border: 0;
}
.sd-light-section .sp[data-section='chat'] .settings-chat-system-prompt {
  height: 68px;
  min-height: 58px;
  max-height: 72px;
  border-color: rgba(75, 62, 49, 0.045);
  background: rgba(255, 253, 249, 0.14);
}
.sd-light-section .sp[data-section='chat'] .settings-mini-group:has(> .settings-chat-system-prompt) .settings-chat-advanced-control > .settings-toggle {
  min-height: 28px;
}
.sd-light-section .sp[data-section='chat'] .settings-chat-relationship-card,
.sd-light-section .sp[data-section='chat'] .settings-chat-relationship-card {
  border-bottom-color: var(--settings-chat-parity-line);
}
.sd-light-section .sp[data-section='chat'] .settings-chat-relationship-card > .settings-mini-group__head:not(summary) {
  min-height: auto;
}
.sd-light-section .sp[data-section='chat'] .onboarding-relationship__options {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  border: 1px solid rgba(75, 62, 49, 0.045);
  border-radius: 8px;
}
.sd-light-section .sp[data-section='chat'] .onboarding-relationship__chip.is-active {
  box-shadow: inset 0 0 0 1px rgba(185, 92, 60, 0.07);
}
.sd-light-section .sp[data-section='chat'] .settings-pet-model-card,
.sd-light-section .sp[data-section='chat'] .settings-pet-preview-card,
.sd-light-section .sp[data-section='chat'] .settings-pet-workflow-card {
  background: rgba(255, 253, 249, 0.1);
}
.sd-light-section .sp[data-section='chat'] .settings-pet-model-card {
  padding: 0 0 6px;
}
.sd-light-section .sp[data-section='chat'] .settings-pet-model-card > .settings-mini-group__head > span {
  display: -webkit-box;
  white-space: normal;
  -webkit-line-clamp: 2;
}
.sd-light-section .sp[data-section='chat'] .settings-pet-model-card .settings-choice-grid {
  border: 1px solid var(--settings-chat-parity-line);
}
.sd-light-section .sp[data-section='chat'] .settings-pet-model-card .settings-choice-card {
  grid-template-columns: minmax(78px, 0.34fr) minmax(0, 1fr);
  min-height: 46px;
}
.sd-light-section .sp[data-section='chat'] .settings-pet-model-card .settings-choice-card__description {
  color: rgba(78, 64, 54, 0.62);
  text-align: left;
  -webkit-line-clamp: 2;
}
.sd-light-section .sp[data-section='chat'] .settings-pet-preview-card {
  padding: 0 0 8px;
  border-bottom-color: var(--settings-chat-parity-line);
}
.sd-light-section .sp[data-section='chat'] .settings-sprite-preview__stage {
  min-height: 118px;
}
.sd-light-section .sp[data-section='chat'] .settings-sprite-preview__states button,
.sd-light-section .sp[data-section='chat'] .settings-companion-state-preview__states button {
  min-height: 28px;
}
.sd-light-section .sp[data-section='chat'] .settings-pet-action-row {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
}
.sd-light-section .sp[data-section='chat'] .settings-pet-action-row .ghost-button {
  min-height: 30px;
}
.sd-light-section .sp[data-section='chat'] .settings-pet-tools > .settings-mini-group__note {
  -webkit-line-clamp: 3;
}
.sd-light-section .sp[data-section='chat'] .settings-pet-workflow-grid {}
.sd-light-section .sp[data-section='chat'] .settings-pet-workflow-card {}
.sd-light-section .sp[data-section='chat'] .settings-pet-workflow-card > .settings-inline-row:not(.settings-pet-creator-actions) input {
  height: 30px;
}
.sd-light-section .sp[data-section='chat'] .settings-community-links {
  display: flex;
  flex-wrap: wrap;
}
.sd-light-section .sp[data-section='chat'] .settings-community-links a {
  flex: 1 1 132px;
  min-height: 28px;
}
.sd-light-section .sp[data-section='chat'] .settings-community-links__text {
  white-space: normal;
}
`,
  'src/app/styles/settings-visual-system.css': `
/* Nexus settings visual system. */
.sb,
.sd {
  --nx-settings-control-height: 30px;
  --nx-settings-control-height-small: 24px;
  --nx-settings-segment-height: 28px;
  --nx-settings-footer-height: 36px;
  --nx-settings-row-height: 38px;
  --nx-settings-field-height: 32px;
  --nx-settings-icon-size: 18px;
  --nx-settings-track-trust: rgba(220, 116, 87, 0.86);
  --nx-settings-track-memory: rgba(90, 164, 76, 0.86);
  --nx-settings-track-desktop: rgba(52, 124, 210, 0.86);
  --nx-settings-track-permission: rgba(135, 82, 207, 0.82);
  --nx-settings-track-appearance: rgba(215, 124, 45, 0.9);
}
.sb-night,
.sd-night {
  --nx-settings-segment-surface: rgba(255, 255, 255, 0.055);
  --nx-settings-segment-active: rgba(255, 255, 255, 0.14);
  --nx-settings-footer-surface: linear-gradient(to bottom, rgba(14, 18, 28, 0), rgba(14, 18, 28, 0.96) 42%);
}
.sb-day,
.sd-day {
  --nx-settings-segment-surface: rgba(56, 65, 78, 0.055);
  --nx-settings-segment-active: rgba(255, 255, 255, 0.86);
  --nx-settings-footer-surface: linear-gradient(to bottom, rgba(250, 252, 255, 0), rgba(250, 252, 255, 0.98) 42%);
}
.sb-warm,
.sd-warm {
  --nx-settings-segment-surface: rgba(78, 62, 46, 0.055);
  --nx-settings-segment-active: rgba(255, 253, 249, 0.78);
  --nx-settings-footer-surface: linear-gradient(to bottom, rgba(255, 250, 243, 0), rgba(255, 250, 243, 0.99) 42%);
}
.sd-section .sp.sp {
  --settings-child-control-height: var(--nx-settings-control-height);
}
.sd-section .sp.sp .sdc.settings-drawer__sections {}
.sd-section .sp.sp .settings-section__title-row {}
.sd-section .sp.sp .settings-control-card:not(.settings-metric-card):not(.settings-updater-panel) {}
.sd-section .sp.sp :is(input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='file']), select, textarea, .settings-url-input) {
  min-height: var(--nx-settings-field-height);
}
.sd-section .sp.sp :is(.settings-form-row__validation, .settings-model-advanced__error, .settings-test-result.is-error, .settings-url-input--invalid) {
  border-color: color-mix(in srgb, var(--nx-settings-danger) 38%, var(--nx-settings-line));
}
.sd-section .sp.sp .settings-toggle input:checked {
  background: linear-gradient(135deg, var(--nx-settings-accent), white);
}
.sd-section .sp.sp .settings-appearance-switch__control {}
.sd-section .sp.sp :is(.onboarding-region-tabs, .onboarding-relationship__options, .settings-sprite-preview__states, .settings-companion-state-preview__states) {
  background: var(--nx-settings-segment-surface);
}
.sd-section .sp.sp .settings-choice-card.is-active {
  background: var(--nx-settings-accent-soft);
}
.sd-section .sp[data-section] .settings-danger-button {
  color: var(--nx-settings-danger);
}
.sd-section .sda {
  background: var(--nx-settings-footer-surface);
}
.sb .confirm-dialog-card {
  background: var(--nx-settings-surface);
}
.sb .confirm-dialog-card__confirm.is-danger {
  background: var(--nx-settings-danger);
}
`,
  'src/app/styles/settings-visibility-final.css': `
/* Settings visibility final layer. This file intentionally loads last. */
/* v0.4.2 tone parity: all settings tones share one shell and home rhythm. */
.sd-home,
.sd-section {
  --settings-concept-ink: var(--nx-settings-ink); --settings-concept-line-soft: var(--nx-settings-line-soft);
  width: min(340px, calc(100vw - 28px)); height: min(720px, calc(100vh - 42px));
}
.sd-night.sd-home {}
.sd-day.sd-home {}
.sd-warm.sd-home {}
.sd-home .settings-home-card[data-trust-group='trustSafety'] { --settings-trust-trace: var(--nx-settings-track-trust); }
.sd-home .settings-home-card {}
.sd-home .sda {}
.sd-home .settings-appearance-switch { border-bottom: 1px solid var(--settings-concept-line-soft); }
/* v0.4.2 settings child-page unity pass. */
.sd-section .sp.sp .sphd { min-height: 48px; border-bottom: 1px solid var(--nx-settings-line-soft); }
.sd-section .sp.sp .settings-page__back { width: var(--nx-settings-control-height-small); }
.sd-section .sp.sp .sph h4 { font-size: 13px; }
.sd-section .sp.sp :is(.settings-section, .settings-mini-group, .settings-drawer__card, .settings-speech-config-section) {}
.sd-section .sda { background: var(--nx-settings-footer-surface); }
`,
  'src/app/styles/settings-product-reference-final.css': `
/* v0.4.2 product-settings reference pass. */
.settings-backdrop:has(.settings-drawer--home),
.settings-backdrop:has(.settings-drawer--section) { background: #efebe5; backdrop-filter: none; }
.sd-home,
.sd-section { width: min(720px, calc(100vw - 20px)); background: #fbf8f3; }
.sd-section .settings-page__layout { grid-template-columns: 168px minmax(0, 1fr); }
.sd-section .settings-section-nav__button.is-active { background: #ffffff; }
.sd-section .sp[data-section='chat'] .settings-chat-relationship-card { height: auto !important; }
.sd-section .sp[data-section='chat'] .settings-mini-group:has(> .settings-chat-system-prompt) { height: auto !important; }
`,
}
