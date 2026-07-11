#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FORBIDDEN_SOURCE_PATTERNS,
  REQUIRED_FILES,
  SETTINGS_STYLE_IMPORT_ORDER,
  SETTINGS_VISUAL_SYSTEM_COVERAGE,
} from './settings-surface-boundaries.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const REQUIRED_CONTRACTS = [
  {
    id: 'settings-options-architecture-doc',
    file: 'docs/SETTINGS_OPTIONS_ARCHITECTURE.md',
    description: 'Settings option placement is documented as an intent architecture, not a visual wishlist.',
    patterns: [
      'Settings is a companion control surface, not a dashboard',
      'Appearance & experience',
      'Companion behavior',
      'Memory & context',
      'Models & connections',
      'Maintenance',
      'history, console, onboarding',
      'src/components/settingsHomeArchitecture.ts',
      'grouped by user meaning',
    ],
  },
  {
    id: 'settings-pro-contract-recorded',
    file: 'docs/SETTINGS_SURFACE_REFERENCE_REVIEW.md',
    description: 'The accepted Pro settings judgment is recorded as a bounded local contract.',
    patterns: [
      'high-trust control panel',
      'what Nexus can see',
      'what Nexus will remember',
      'when Nexus may act',
      'pause, revoke, disable, or clear',
      'settings = trust boundary map + quick control panel',
    ],
  },
  {
    id: 'settings-visual-system-contract-doc',
    file: 'docs/SETTINGS_SURFACE_REFERENCE_REVIEW.md',
    description: 'The 0.4.2 settings visual system contract names the tone and control-family boundaries.',
    patterns: [
      'v0.4.2 Settings Visual System Contract',
      'warm white, black-white/day, and night',
      'child pages, dialogs, fields, toggles, segmented controls, footer actions, error/validation states, active choices, and destructive actions',
      'opening any settings page should feel like the same product',
      'same row height logic, radius, icon scale, control density, focus behavior, disabled behavior, and save/cancel footer rhythm',
    ],
  },
  {
    id: 'settings-reference-boundaries',
    file: 'docs/SETTINGS_SURFACE_REFERENCE_REVIEW.md',
    description: 'Settings borrows reference boundaries without copying product chrome.',
    patterns: [
      'LibreChat',
      'Cherry Studio',
      'AnythingLLM',
      'shadcn/ui',
      'Radix UI Primitives',
      'Provider, agent, tool, file, and admin boundaries',
    ],
  },
  {
    id: 'settings-trust-group-contract',
    file: 'docs/SETTINGS_SURFACE_REFERENCE_REVIEW.md',
    description: 'Settings groups are described by user trust boundaries, not internal modules.',
    patterns: [
      'Trust & Safety',
      'Memory & Context',
      'Desktop Awareness',
      'Permissions & Integrations',
      'Appearance & Interaction',
    ],
  },
  {
    id: 'source-visible-trust-groups',
    file: 'src/components/settingsDrawerMetadata.ts',
    description: 'Settings source exposes trust-boundary groups before visual regrouping.',
    patterns: [
      'SETTINGS_TRUST_SURFACE_GROUPS',
      'getSettingsTrustSurfaceGroupId',
      'trustSafety',
      'memoryContext',
      'desktopAwareness',
      'permissionsIntegrations',
      'appearanceInteraction',
      "'memory'",
      "'autonomy'",
      "'integrations'",
      "'tools'",
    ],
  },
  {
    id: 'settings-home-content-architecture',
    file: 'src/components/settingsHomeArchitecture.ts',
    description: 'Settings home content is grouped by user intent before it reaches the drawer renderer.',
    patterns: [
      'SETTINGS_HOME_GROUPS',
      'SETTINGS_HOME_SECTION_ORDER',
      'compareSettingsHomeSections',
      "'appearanceExperience'",
      "'companionBehavior'",
      "'memoryContext'",
      "'modelConnections'",
      "'maintenance'",
      "titleKey: 'settings.home.group.appearance_experience'",
      "titleKey: 'settings.home.group.companion_behavior'",
      "titleKey: 'settings.home.group.memory_context'",
      "titleKey: 'settings.home.group.model_connections'",
      "titleKey: 'settings.home.group.maintenance'",
      "sectionIds: ['history', 'console']",
      "actionId: 'onboarding'",
    ],
  },
  {
    id: 'settings-home-viewmodel-wiring',
    file: 'src/components/SettingsDrawer.tsx',
    description: 'The drawer builds settings home rows as trust-boundary view models before handing rendering to the home component.',
    patterns: [
      'settingsHomeGroups',
      'getSettingsTrustSurfaceGroupId(section.id)',
      'trustGroup: getSettingsTrustSurfaceGroupId(section.id)',
      '<SettingsHomeView',
      'groups={settingsHomeGroups}',
      'onOpenHomeAction={handleOpenSettingsHomeAction}',
    ],
  },
  {
    id: 'settings-theme-section-scope-classes',
    file: 'src/components/SettingsDrawer.tsx',
    description: 'The drawer exposes short section-scoped theme classes so large settings CSS layers do not need long repeated page selectors.',
    patterns: [
      'settings-drawer--light-section',
      'settings-drawer--warm-section',
      'settings-drawer--day-section',
    ],
  },
  {
    id: 'settings-home-trust-boundary-traces',
    file: 'src/components/SettingsHomeView.tsx',
    description: 'Settings home rows expose their trust boundary without adding dashboard groups.',
    patterns: [
      'SettingsHomeViewProps',
      'renderSettingsAppearanceSwitch',
      'renderSettingsHomeAction',
      "import { SettingsHomePresence } from './SettingsHomePresence.tsx'",
      '<SettingsHomePresence',
      'settings-home-group',
      'settings-home-group__head',
      'settings-home-group__list',
      'data-settings-home-group={group.id}',
      'data-trust-group={action.trustGroup}',
      'data-trust-group={card.trustGroup}',
      'onOpenSettingsSection(card.sectionId)',
      'onOpenHomeAction(action)',
    ],
  },
  {
    id: 'settings-home-presence-component',
    file: 'src/components/SettingsHomePresence.tsx',
    description: 'Settings home identity is isolated from the large drawer renderer while preserving the Settings-center icon and copy slots.',
    patterns: [
      'SettingsHomePresenceProps',
      'className="settings-home-presence"',
      'aria-labelledby="settings-home-presence-title"',
      'settings-home-presence__icon',
      '<PetControlIcon name="settings" />',
      'settings-home-presence__badge',
      'settings-home-presence__body',
    ],
  },
  {
    id: 'settings-home-trust-trace-css',
    file: 'src/app/styles/settings-home.css',
    description: 'Settings home rows use subtle trust traces while preserving the compact row grammar.',
    patterns: [
      "--settings-trust-trace",
      ".sd .settings-home-card[data-trust-group='trustSafety']",
      ".sd .settings-home-card[data-trust-group='memoryContext']",
      ".sd .settings-home-card[data-trust-group='desktopAwareness']",
      ".sd .settings-home-card[data-trust-group='permissionsIntegrations']",
      ".sd .settings-home-card[data-trust-group='appearanceInteraction']",
      'border-left-color: var(--settings-trust-trace);',
      '.settings-home-group',
      '.settings-home-group__head',
      '.settings-home-group__title',
      '.settings-home-group__hint',
      '.settings-home-group__list',
      '.settings-home-card--action',
    ],
  },
  {
    id: 'active-section-boundaries',
    file: 'src/components/SettingsDrawerActiveSection.tsx',
    description: 'High-trust settings surfaces remain explicit section boundaries.',
    patterns: [
      'MemorySection',
      'IntegrationsSection',
      'ToolsSection',
      'AutonomySection',
      'WindowSection',
      'ModelSection',
      'HistorySection',
      'ConsoleSection',
      'confirm',
    ],
  },
  {
    id: 'high-trust-history-memory-affordances',
    file: 'src/components/SettingsDrawerActiveSection.tsx',
    description: 'History and memory settings keep source-visible export, clear, inspect, disable, and remove controls.',
    patterns: [
      'confirm={confirm}',
      'onExportChatHistory={() => void chatHistory.handleExportChatHistory()}',
      'onClearChatHistory={() => void chatHistory.handleClearChatHistory()}',
      'memoryFocus={memoryFocus}',
      'onExportMemoryArchive={() => void memoryArchive.handleExportMemoryArchive()}',
      'onClearMemoryArchive={() => void memoryArchive.handleClearMemoryArchive()}',
      'onSetMemoryEnabled={onSetMemoryEnabled}',
      'onRemoveMemory={onRemoveMemory}',
      'onClearDailyMemory={onClearDailyMemory}',
      'onRemoveDailyEntry={onRemoveDailyEntry}',
    ],
  },
  {
    id: 'external-tool-permission-affordances',
    file: 'src/components/settingsSections/ToolsSection.tsx',
    description: 'External tools expose enable, confirmation, and dependency-disabled controls instead of silent capability toggles.',
    patterns: [
      'field="toolWebSearchEnabled"',
      'field="toolWeatherEnabled"',
      'field="toolOpenExternalEnabled"',
      'field="toolOpenExternalRequiresConfirmation"',
      'disabled={!draft.toolOpenExternalEnabled}',
      'disabled={!draft.toolWebSearchEnabled',
      'disabled={!draft.toolWeatherEnabled}',
      'displaySecretInputValue(draft.toolWebSearchApiKey)',
    ],
  },
  {
    id: 'compact-settings-scale',
    file: 'src/app/styles/settings.css',
    description: 'Settings keeps the compact drawer scale instead of expanding into a dashboard.',
    patterns: [
      '--settings-control-height: 26px;',
      '--settings-body-font-size: 10px;',
      'width: min(300px, calc(100vw - 18px));',
      'max-height: min(470px, calc(100vh - 18px));',
    ],
  },
  {
    id: 'settings-home-chat-alignment-layer',
    file: 'src/app/styles/settings-chat-aligned.css',
    description: 'Warm settings home can align visually with chat while preserving the compact settings contract elsewhere.',
    patterns: [
      '.sd-warm.sd-home',
      '--settings-control-height: 26px;',
      '--settings-home-row-trace: rgba(75, 62, 49, 0.08);',
      '--settings-home-row-glyph: rgba(78, 64, 54, 0.32);',
      '--settings-surface: rgba(255, 250, 242, 0.985);',
      'linear-gradient(180deg, rgba(255, 250, 242, 0.985), rgba(246, 236, 222, 0.975));',
      'border-left: 2px solid var(--settings-home-row-trace);',
      'width: min(340px, calc(100vw - 28px));',
      '.sd-warm.sd-home .sdh',
      'border-bottom: 1px solid rgba(75, 62, 49, 0.08);',
      'background: transparent;',
      '.sd-warm.sd-home .settings-drawer__window-title',
      'letter-spacing: 0;',
      'color: rgba(36, 27, 22, 0.78);',
      '.sd-warm.sd-home .sdtb',
      'width: var(--settings-control-height-small);',
      'height: var(--settings-control-height-small);',
      'border: 1px solid transparent;',
      'background: rgba(75, 62, 49, 0.055);',
      'width: 12px;',
      '.sd-warm.sd-home .settings-appearance-switch',
      'min-height: var(--settings-control-height);',
      'background: rgba(255, 253, 249, 0.16);',
      '.sd-warm.sd-home .settings-appearance-switch__option.is-active',
      'border-color: transparent;\n  background: rgba(185, 92, 60, 0.09);',
      'box-shadow: inset 0 0 0 1px rgba(185, 92, 60, 0.1);',
      '.sd-warm.sd-home .settings-home-card',
      'background: rgba(255, 253, 249, 0.12);',
      '.sd-warm.sd-home .settings-home-card__glyph',
      'color: var(--settings-home-row-glyph);',
      '.sd-warm.sd-section',
      '--settings-child-control-height: 21px;',
      '--settings-child-field-height: 21px;',
      '.sd-warm-section .sdc.settings-drawer__sections',
      '.sd-warm-section .settings-section',
      '.sd-warm-section .settings-model-source-card',
      '.sd-warm-section .settings-model-source-card.is-selected',
      'background: rgba(185, 92, 60, 0.08);',
      ".sd-warm-section .sp[data-section='window'] label.settings-window-field",
      'grid-template-columns: minmax(82px, 0.42fr) minmax(0, 1fr);',
      'background: rgba(255, 253, 249, 0.14);',
      'white-space: nowrap;',
      ".sd-warm-section .sp[data-section='window'] label.settings-window-field > select",
      'min-height: var(--settings-control-height-small);',
      ".sd-warm-section input:not([type='checkbox']):not([type='radio']):not([type='range'])",
      'border-radius: 10px;',
      'background: rgba(255, 253, 249, 0.34);',
      '.sd-warm-section .settings-control-card',
      'background: rgba(255, 253, 249, 0.18);',
      '.sd-warm-section .onboarding-relationship__chip',
      '.sd-warm-section .settings-toggle:not(.settings-lorebook-check)',
      '.sd-warm-section .settings-control-card:has(> .settings-toggle input:disabled)',
      '.sd-warm-section .settings-toggle input:checked',
      'background: rgba(185, 92, 60, 0.18);',
      '.sd-warm-section .settings-metric-card',
      '.sd-warm-section .settings-history-empty',
      '.sd-warm-section .settings-letter-empty',
      '.sd-warm-section .settings-action-row',
      '.sd-warm-section .settings-action-row button:disabled',
      '.sd-warm-section .settings-autonomy-channel__badge',
      '.sd-warm-section .settings-updater-panel',
      '.sd-warm-section .settings-page__back span',
      '.sd-warm.sd-home .sda',
      '.sd-warm.sd-section .sda',
      '--settings-action-control-height: 21px;',
      'border-top: 1px solid rgba(75, 62, 49, 0.08);',
      'box-shadow: none;',
      'grid-template-columns: minmax(82px, 0.76fr) minmax(0, 1.24fr);',
      'border-color: transparent;',
      'rgba(185, 92, 60, 0.095)',
      "html[data-theme='warm-day'] .sd-warm.sd-home .sda .primary-button",
    ],
  },
  {
    id: 'settings-chat-style-import-spine',
    file: 'src/app/settingsDrawerEntry.ts',
    description: 'The app-layer lazy settings entry owns the settings style layers before the settings drawer can paint.',
    patterns: [
      "import './styles/settings.css'",
      "import './styles/settings-home.css'",
      "import './styles/settings-themes.css'",
      "import './styles/settings-chat-aligned.css'",
      "import './styles/settings-chat-final.css'",
      "import './styles/settings-chat-role-final.css'",
      "import './styles/settings-visibility-final.css'",
      "export { SettingsDrawer } from '../components/SettingsDrawer'",
    ],
  },
  {
    id: 'settings-chat-final-parity-layer',
    file: 'src/app/styles/settings-chat-final.css',
    description: 'The final settings layer keeps chat parity overrides split from the large base alignment file.',
    patterns: [
      'Final chat-parity pass',
      '--settings-chat-parity-line:',
      '--settings-chat-parity-row:',
      '--settings-chat-parity-command:',
      '--settings-surface: #fffaf3;',
      'linear-gradient(180deg, #fffaf3 0%, #f6ecde 100%);',
      'backdrop-filter: none;',
      '-webkit-backdrop-filter: none;',
      '--settings-control-font-size: 10px;',
      '--settings-meta-font-size: 9px;',
      'width: min(340px, calc(100vw - 28px));',
      'height: min(640px, calc(100vh - 48px));',
      'background: rgba(241, 229, 211, 0.55);',
      'position: relative;',
      'isolation: isolate;',
      'background-color: #fffaf3;',
      'background-image:',
      ".sd-light.sd-home::before",
      'z-index: 0;',
      ".sd-light.sd-home > *",
      'z-index: 1;',
      'grid-template-rows: auto minmax(0, 1fr) auto;',
      '.sd-light.sd-home .sdb',
      '.sd-light.sd-home .settings-drawer__window-title-name',
      'display: inline;',
      'font-weight: 620;',
      '.sd-light.sd-home .settings-drawer__window-title-label',
      'clip-path: inset(50%);',
      'white-space: nowrap;',
      'content: none;',
      '.sd-light.sd-home .sdh',
      'border-bottom: 1px solid transparent;',
      'border-radius: 0;',
      'box-shadow: none;',
      '.sd-light.sd-home .sdhm',
      'min-height: 28px;',
      'border: 0;',
      'background: transparent;',
      '.sd-light.sd-home .sdtb',
      'padding: 0;',
      'width: 20px;',
      'height: 20px;',
      'border-radius: 6px;',
      '.sd-light.sd-home .settings-home',
      'gap: 2px;',
      '.sd-light.sd-home .settings-home-group',
      '.sd-light.sd-home .settings-home-group__head',
      '.sd-light.sd-home .settings-home-group__title',
      '.sd-light.sd-home .settings-home-group__hint',
      '.sd-light.sd-home .settings-home-group__list',
      'grid-template-columns: 18px minmax(0, 1fr) minmax(68px, min(48%, 176px));',
      'min-height: 38px;',
      '.sd-light.sd-home .settings-home-card__label',
      'grid-column: 2;',
      '.sd-light.sd-home .settings-home-card__value',
      'grid-column: 3;',
      'color: rgba(78, 64, 54, 0.66);',
      '.sd-light.sd-home .settings-home-card__glyph',
      'grid-column: 1;',
      'justify-self: center;',
      'opacity: 0.62;',
      '.sd-light-section .settings-control-card',
      '.sd-light-section .settings-form-row',
      '.sd-light-section .sdc.settings-drawer__sections',
      'padding-bottom: 104px;',
      'scroll-padding-bottom: 90px;',
      'mask-image: linear-gradient(180deg, #000 0, #000 calc(100% - 22px), transparent 100%);',
      ".sd-light-section .sp[data-section='model'] .onboarding-region-tabs",
      'border: 1px solid var(--settings-chat-parity-line);',
      'border-radius: 9px;',
      ".sd-light-section .sp[data-section='model'] .onboarding-region-tabs__tab",
      'min-height: 30px;',
      'border-radius: 7px;',
      ".sd-light-section .sp[data-section='model'] .onboarding-region-tabs__tab.is-active",
      'box-shadow: inset 0 0 0 1px rgba(185, 92, 60, 0.1);',
      ".sd-light-section .sp[data-section='model'] .settings-model-source-grid",
      'grid-template-columns: 1fr;',
      ".sd-light-section .sp[data-section='model'] .settings-model-source-card",
      'grid-template-columns: 20px minmax(0, 1fr) 14px;',
      ".sd-light-section .sp[data-section='model'] .settings-model-source-card__logoFallback",
      'width: 18px;',
      'font-size: 8px;',
      ".sd-light-section .sp[data-section='model'] .settings-model-source-card__meta",
      'grid-row: 2;',
      'font-size: 10px;',
      'color: rgba(78, 64, 54, 0.5);',
      ".sd-light-section .sp[data-section='model'] .settings-model-source-card__chevron",
      ".sd-light-section .sp[data-section='model'] .settings-model-detail-card",
      'padding: 0 0 8px;',
      ".sd-light-section .sp[data-section='model'] .settings-model-detail-brand",
      'display: grid;',
      ".sd-light-section .sp[data-section='model'] .settings-model-detail-nav .ghost-button",
      ".sd-light-section .sp[data-section='model'] .settings-model-detail-fields",
      'border-top: 0;',
      ".sd-light-section .sp[data-section='model'] .settings-model-detail-card__logoFallback",
      ".sd-light-section .sp[data-section='model'] .settings-model-detail-fields > label",
      'grid-template-columns: minmax(92px, 0.32fr) minmax(0, 1fr);',
      'min-height: 42px;',
      ".sd-light-section .sp[data-section='model'] .settings-model-detail-fields > label > :is(input:not([type='checkbox']):not([type='range']), select, .settings-url-input)",
      'height: 32px;',
      'line-height: 30px;',
      ".sd-light-section .sp[data-section='model'] .settings-model-advanced > summary",
      ".sd-light-section .sp[data-section='tools'] .settings-tools-section > .settings-control-grid",
      ".sd-light-section .sp[data-section='tools'] .settings-tools-section > .settings-control-grid > .settings-control-card",
      'min-height: 36px;',
      ".sd-light-section .sp.sp:is([data-section='tools'], [data-section='window']) label:is(.settings-tools-field, .settings-window-field)",
      'grid-template-columns: minmax(84px, 0.38fr) minmax(0, 1fr);',
      'min-height: 40px;',
      ".sd-light-section .sp.sp:is([data-section='tools'], [data-section='window']) label:is(.settings-tools-field, .settings-window-field) > select",
      'height: 30px;',
      'text-align: right;',
      ".sd-light-section .sph h4:focus",
      'outline: none;',
      ".sd-light-section .sp[data-section='autonomy'] .settings-autonomy-group",
      ".sd-light-section .sp[data-section='autonomy'] .settings-drawer__card",
      ".sd-light-section .sp[data-section='autonomy'] .settings-drawer__card .settings-page__meta",
      ".sd-light-section .sp[data-section='autonomy'] .settings-drawer__card .settings-page__meta > span",
      ".sd-light-section .sp[data-section='autonomy'] .settings-drawer__card > .settings-toggle",
      'border-top: 1px solid var(--settings-chat-parity-line);',
      '.settings-control-card:not(.settings-metric-card):not(.settings-updater-panel)',
      'border-radius: 8px;',
      ".sd-light-section .settings-choice-card.is-active",
      ".sd-light-section .sp[data-section='memory'] .settings-memory-transparency__grid",
      'gap: 0;',
      ".sd-light-section .sp[data-section='memory'] .settings-control-card.settings-memory-transparency__card:not(.settings-metric-card):not(.settings-updater-panel)",
      'grid-template-columns: minmax(72px, 0.28fr) minmax(0, 1fr);',
      ".sd-light-section .sp[data-section='memory'] .settings-memory-context-status-grid",
      ".sd-light-section .sp[data-section='memory'] .settings-memory-context-status",
      'grid-template-rows: auto auto;',
      'min-height: 44px;',
      ".sd-light-section .sp[data-section='memory'] .settings-control-card.settings-memory-context-status",
      ".sd-light-section .sp[data-section='memory'] .settings-control-card.settings-memory-context-status:not(.settings-metric-card):not(.settings-updater-panel)",
      ".sd-light-section .sp[data-section='memory'] .settings-memory-context-status__head",
      'grid-template-columns: minmax(0, 1fr) minmax(42px, auto);',
      ".sd-light-section .sp[data-section='memory'] .settings-memory-context-status__head span",
      'min-width: 42px;',
      ".sd-light-section .sp[data-section='memory'] .settings-memory-context-status.is-active .settings-memory-context-status__head span",
      'background: rgba(82, 136, 118, 0.08);',
      ".sd-light-section .sp[data-section='memory'] .settings-memory-context-status.is-unavailable",
      'opacity: 1;',
      ".sd-light-section .sp[data-section='memory'] .settings-memory-context-transparency__rows",
      ".sd-light-section .sp[data-section='memory'] .settings-memory-context-transparency__row",
      'grid-template-columns: minmax(80px, 0.33fr) minmax(0, 1fr);',
      'border-bottom: 1px solid var(--settings-chat-parity-line);',
      ".sd-light-section .sp[data-section='memory'] .settings-memory-context-actions .ghost-button",
      ".sd-light-section .sp[data-section='memory'] .settings-memory-archive-actions .ghost-button",
      ".sd-light-section .sp[data-section='memory'] .memory-card__actions .ghost-button",
      ".sd-light-section .sp[data-section='memory'] .settings-memory-group > .settings-memory-field > .settings-form-row > input:not([type='checkbox']):not([type='radio']):not([type='range'])",
      ".sd-light-section .sp[data-section='memory'] .settings-memory-recall-grid input:not([type='checkbox']):not([type='range'])",
      ".sd-light-section .sp[data-section='memory'] .settings-memory-group > label.settings-memory-field > select",
      'min-height: 32px;',
      'padding: 0 34px 0 8px;',
      '.settings-toggle input:checked',
      'linear-gradient(135deg, rgba(199, 102, 69, 0.82), rgba(224, 148, 93, 0.72));',
      "input:not([type='checkbox']):not([type='radio']):not([type='range'])",
      'justify-content: flex-end;',
      'gap: 8px;',
      'min-height: 31px;',
      '.sd-light-section .settings-updater-panel__actions .ghost-button',
      ".sd-light-section .sp[data-section='voice'] .settings-voice-loop-card > label.settings-voice-field",
      'min-height: 54px;',
      ".sd-light-section .sp[data-section='voice'] .settings-voice-loop-card > label.settings-voice-field > select",
      'height: 34px;',
      'padding: 0 28px 0 10px;',
      'color: rgba(36, 27, 22, 0.84);',
      ".sd-light-section .sp[data-section='voice'] .settings-voice-loop-card > label.settings-control-card.settings-voice-field:not(.settings-metric-card):not(.settings-updater-panel)",
      'grid-template-columns: minmax(108px, 0.36fr) minmax(0, 1fr);',
      ".sd-light-section .sp[data-section='voice'] .settings-voice-loop-card > label.settings-control-card.settings-voice-field:not(.settings-metric-card):not(.settings-updater-panel) > span",
      ".sd-light-section .sp[data-section='voice'] .settings-voice-loop-card > label.settings-control-card.settings-voice-field:not(.settings-metric-card):not(.settings-updater-panel) > select",
      'line-height: 1.2;',
      ".sd-light-section .sp[data-section='voice'] .settings-speech-config-section > .settings-section__title-row",
      'grid-template-columns: minmax(0, 1fr) minmax(96px, auto);',
      ".sd-light-section .sp[data-section='voice'] .settings-speech-config-section > .settings-section__title-row > div",
      'display: contents;',
      ".sd-light-section .sp[data-section='voice'] .settings-speech-config-section > .settings-section__title-row .settings-drawer__hint",
      'grid-column: 1 / -1;',
      ".sd-light-section .sp[data-section='voice'] .settings-speech-config-section > .settings-section__title-row > .ghost-button",
      'min-width: 96px;',
      ".sd-light-section .sp[data-section='voice'] .settings-speech-preview-button",
      ".sd-light-section .sp[data-section='voice'] .settings-speech-config-section > label.settings-control-card.settings-speech-config-field:not(:has(> textarea)):not(:has(> .settings-drawer__hint)):not(.settings-metric-card):not(.settings-updater-panel)",
      'align-items: center;',
      ".sd-light-section .sp[data-section='voice'] .settings-speech-config-section > label.settings-control-card.settings-speech-config-field:not(:has(> textarea)):not(:has(> .settings-drawer__hint)):not(.settings-metric-card):not(.settings-updater-panel) > :is(input:not([type='checkbox']):not([type='range']), select, .settings-url-input)",
      ".sd-light-section .sp[data-section='voice'] .settings-speech-config-section > .settings-speech-config-note",
      '-webkit-line-clamp: 3;',
      ".sd-light-section .sp[data-section='voice'] .settings-tts-tuning__item",
      'padding: 6px 2px 7px;',
      ".sd-light-section .sp[data-section='voice'] .settings-tts-tuning__controls",
      'grid-template-columns: minmax(0, 1fr) 72px;',
      ".sd-light-section .sp[data-section='voice'] input.settings-tts-tuning__number:not([type='checkbox']):not([type='range'])",
      ".sd-light-section .sp[data-section='voice'] .settings-mini-group__head span",
      'color: rgba(78, 64, 54, 0.58);',
      'min-width: 112px;',
      'background: var(--settings-chat-parity-command);',
    ],
  },
  {
    id: 'settings-tools-disabled-field-readability',
    file: 'src/app/styles/settings-chat-final.css',
    description: 'Tools backend fields keep disabled states legible while matching the compact chat rhythm.',
    patterns: [
      'Tools permissions use disabled fields as readable status, not empty form holes.',
      ".sp[data-section='tools'] .settings-mini-group",
      'grid-template-columns: 1fr;',
      ".sp[data-section='tools'] label.settings-tools-field > :is(input, select, .settings-url-input)",
      ".sp[data-section='tools'] .settings-tools-section .settings-mini-group > label.settings-tools-field > :is(input, select, .settings-url-input):not([type='checkbox']):not([type='range'])",
      'min-height: 30px;',
      'background: rgba(255, 253, 249, 0.2);',
      ".sp[data-section='tools'] label.settings-tools-field > :is(input, select, .settings-url-input):disabled",
      'background: transparent;',
      '-webkit-text-fill-color: rgba(78, 64, 54, 0.58);',
      'opacity: 1;',
      ".sp[data-section='tools'] label.settings-tools-field > :is(input, .settings-url-input)::placeholder",
      '-webkit-text-fill-color: rgba(78, 64, 54, 0.46);',
      ".sp[data-section='tools'] .settings-tools-section > .settings-mini-group:has(> .settings-tools-control) > .settings-tools-control",
      'padding: 0 6px;',
      ".sp[data-section='tools'] .settings-tools-control > .settings-toggle",
    ],
  },
  {
    id: 'settings-console-status-list-parity',
    file: 'src/app/styles/settings-chat-final.css',
    description: 'Console status summaries use compact status-list rows instead of oversized dashboard cards.',
    patterns: [
      ".sp[data-section='console'] .settings-section > .settings-console-grid",
      'border-top: 1px solid var(--settings-chat-parity-line);',
      ".sp[data-section='console'] .settings-section > .settings-console-grid > .settings-console-card",
      'min-height: 54px;',
      'border-bottom: 1px solid var(--settings-chat-parity-line);',
      ".sp[data-section='console'] .settings-console-badge",
      'font-size: 10px;',
      ".sp[data-section='console'] .settings-console-card__headline",
      'grid-template-columns: minmax(0, 1fr) minmax(72px, auto);',
      ".sp[data-section='console'] .settings-console-card p",
      '-webkit-line-clamp: 1;',
      ".sp[data-section='console'] .settings-console-sections",
      'margin-top: 6px;',
      ".sp[data-section='console'] details.settings-console-section",
      'background: transparent;',
      ".sp[data-section='console'] details.settings-console-section > summary.settings-console-section__header",
      'grid-template-columns: minmax(0, 1fr) minmax(36px, auto) 14px;',
      'min-height: 48px;',
      'border-radius: 0;',
      ".sp[data-section='console'] details.settings-console-section > summary.settings-console-section__header p",
      '-webkit-line-clamp: 2;',
      ".sp[data-section='console'] details.settings-console-section > summary.settings-console-section__header .settings-console-section__meta",
      'min-height: 24px;',
      ".sp[data-section='console'] .settings-console-sections > section.settings-console-section",
      'box-shadow: none;',
      ".sp[data-section='console'] .settings-console-sections > section.settings-console-section .settings-console-grid--spaced",
      'gap: 0;',
      ".sp[data-section='console'] .settings-console-sections > section.settings-console-section .settings-console-card",
    ],
  },
  {
    id: 'settings-history-maintenance-parity',
    file: 'src/app/styles/settings-chat-final.css',
    description: 'History maintenance controls use compact status rows with readable import/export actions.',
    patterns: [
      ".sp[data-section='history'] .settings-history-summary-grid",
      'grid-template-columns: 1fr;',
      'border-top: 1px solid var(--settings-chat-parity-line);',
      ".sp[data-section='history'] .settings-history-summary-grid .settings-metric-card",
      'grid-template-columns: minmax(0, 1fr) minmax(52px, auto);',
      'border-bottom: 1px solid var(--settings-chat-parity-line);',
      ".sp[data-section='history'] .settings-history-note",
      '-webkit-line-clamp: 2;',
      ".sp[data-section='history'] .settings-history-actions",
      'grid-template-columns: repeat(2, minmax(0, 1fr));',
      ".sp[data-section='history'] .settings-history-actions > button",
      'min-height: 30px;',
      ".sp[data-section='history'] .settings-history-actions .settings-history-clear-button",
      'grid-column: 1 / -1;',
      ".sp[data-section='history'] .settings-history-empty",
      'min-height: 36px;',
    ],
  },
  {
    id: 'settings-letter-empty-state-parity',
    file: 'src/app/styles/settings-chat-final.css',
    description: 'Letters empty state uses the compact status-row grammar instead of a standalone card.',
    patterns: [
      ".sp[data-section='letters'] .settings-letter-section",
      'gap: 6px;',
      ".sp[data-section='letters'] .settings-letter-group",
      'gap: 5px;',
      ".sp[data-section='letters'] .settings-letter-empty",
      'min-height: 54px;',
      'border-top: 1px solid var(--settings-chat-parity-line);',
      'border-bottom: 1px solid var(--settings-chat-parity-line);',
      'border-radius: 0;',
      'background: transparent;',
      ".sp[data-section='letters'] .settings-letter-empty strong",
      'white-space: nowrap;',
      ".sp[data-section='letters'] .settings-letter-empty__label",
      '-webkit-line-clamp: 2;',
    ],
  },
  {
    id: 'settings-lorebook-row-parity',
    file: 'src/app/styles/settings-chat-final.css',
    description: 'Lorebook entries use compact SettingRow-style controls instead of nested form cards.',
    patterns: [
      ".sp[data-section='lorebooks'] .settings-lorebook-list",
      'border-top: 1px solid var(--settings-chat-parity-line);',
      ".sp[data-section='lorebooks'] .settings-lorebook-item",
      'border-bottom: 1px solid var(--settings-chat-parity-line);',
      'background: transparent;',
      ".sp[data-section='lorebooks'] .settings-lorebook-item__toolbar",
      'grid-template-areas:',
      '"label label label"',
      '"enabled priority delete"',
      ".sp[data-section='lorebooks'] .settings-lorebook-title-field",
      ".sp[data-section='lorebooks'] .settings-lorebook-keywords-field",
      'min-height: 40px;',
      ".sp[data-section='lorebooks'] .settings-lorebook-check",
      'grid-template-columns: minmax(0, 1fr) 44px;',
      'min-height: 30px;',
      'gap: 4px;',
      'padding: 0 6px;',
      ".sp[data-section='lorebooks'] .settings-lorebook-priority",
      'grid-template-columns: minmax(70px, 1fr) 50px;',
      'gap: 0;',
      ".sp[data-section='lorebooks'] .settings-lorebook-priority > input:not([type='checkbox']):not([type='range'])",
      'min-width: 0;',
      'height: 30px;',
      ".sp[data-section='lorebooks'] .settings-lorebook-section__actions .ghost-button",
      ".sp[data-section='lorebooks'] .settings-lorebook-content-field > textarea",
      'height: 76px;',
      ".sp[data-section='lorebooks'] .settings-lorebook-empty",
      'min-height: 36px;',
    ],
  },
  {
    id: 'settings-chat-role-final-parity-layer',
    file: 'src/app/styles/settings-chat-role-final.css',
    description: 'Chat role settings keep their companion-specific parity overrides in a bounded light-theme file.',
    patterns: [
      'Chat-section parity pass',
      ".sd-light-section .sp[data-section='chat'] .settings-chat-identity-field > .settings-form-row",
      'grid-template-columns: minmax(70px, 0.36fr) minmax(0, 1fr);',
      'min-height: 30px;',
      ".sd-light-section .sp[data-section='chat'] .settings-chat-identity-field > .settings-form-row > input:not([type='checkbox']):not([type='radio']):not([type='range'])",
      'height: 30px;',
      'border-color: rgba(75, 62, 49, 0.045);',
      'background: rgba(255, 253, 249, 0.16);',
      ".sd-light-section .sp[data-section='chat'] .settings-mini-group:has(> .settings-chat-system-prompt)",
      'border-bottom: 1px solid var(--settings-chat-parity-line);',
      ".sd-light-section .sp[data-section='chat'] .settings-mini-group:not(.settings-pet-model-card):not(.settings-pet-preview-card):not(.settings-pet-workflow-card):has(> .settings-chat-system-prompt):has(> .settings-control-card)",
      'border: 0;',
      ".sd-light-section .sp[data-section='chat'] .settings-chat-system-prompt",
      'height: 68px;',
      'min-height: 58px;',
      'max-height: 72px;',
      'background: rgba(255, 253, 249, 0.14);',
      ".sd-light-section .sp[data-section='chat'] .settings-mini-group:has(> .settings-chat-system-prompt) .settings-chat-advanced-control > .settings-toggle",
      'min-height: 28px;',
      ".sd-light-section .sp[data-section='chat'] .settings-chat-relationship-card",
      ".sd-light-section .sp[data-section='chat'] .settings-chat-relationship-card > .settings-mini-group__head:not(summary)",
      'min-height: auto;',
      'border-bottom-color: var(--settings-chat-parity-line);',
      ".sd-light-section .sp[data-section='chat'] .onboarding-relationship__options",
      'grid-template-columns: repeat(4, minmax(0, 1fr));',
      'gap: 1px;',
      'border: 1px solid rgba(75, 62, 49, 0.045);',
      'border-radius: 8px;',
      ".sd-light-section .sp[data-section='chat'] .onboarding-relationship__chip.is-active",
      'box-shadow: inset 0 0 0 1px rgba(185, 92, 60, 0.07);',
      ".sd-light-section .sp[data-section='chat'] .settings-pet-model-card",
      ".sd-light-section .sp[data-section='chat'] .settings-pet-preview-card",
      ".sd-light-section .sp[data-section='chat'] .settings-pet-workflow-card",
      'padding: 0 0 6px;',
      ".sd-light-section .sp[data-section='chat'] .settings-pet-model-card > .settings-mini-group__head > span",
      'display: -webkit-box;',
      'white-space: normal;',
      '-webkit-line-clamp: 2;',
      ".sd-light-section .sp[data-section='chat'] .settings-pet-model-card .settings-choice-grid",
      'border: 1px solid var(--settings-chat-parity-line);',
      ".sd-light-section .sp[data-section='chat'] .settings-pet-model-card .settings-choice-card",
      'grid-template-columns: minmax(78px, 0.34fr) minmax(0, 1fr);',
      'min-height: 46px;',
      ".sd-light-section .sp[data-section='chat'] .settings-pet-model-card .settings-choice-card__description",
      'color: rgba(78, 64, 54, 0.62);',
      'text-align: left;',
      'padding: 0 0 8px;',
      ".sd-light-section .sp[data-section='chat'] .settings-sprite-preview__stage",
      'min-height: 118px;',
      ".sd-light-section .sp[data-section='chat'] .settings-sprite-preview__states button",
      ".sd-light-section .sp[data-section='chat'] .settings-companion-state-preview__states button",
      ".sd-light-section .sp[data-section='chat'] .settings-pet-action-row",
      'grid-template-columns: repeat(2, minmax(0, 1fr));',
      'gap: 4px;',
      ".sd-light-section .sp[data-section='chat'] .settings-pet-action-row .ghost-button",
      ".sd-light-section .sp[data-section='chat'] .settings-pet-tools > .settings-mini-group__note",
      '-webkit-line-clamp: 3;',
      ".sd-light-section .sp[data-section='chat'] .settings-pet-workflow-grid",
      ".sd-light-section .sp[data-section='chat'] .settings-pet-workflow-card > .settings-inline-row:not(.settings-pet-creator-actions) input",
      ".sd-light-section .sp[data-section='chat'] .settings-community-links",
      'display: flex;',
      'flex-wrap: wrap;',
      ".sd-light-section .sp[data-section='chat'] .settings-community-links a",
      'flex: 1 1 132px;',
      ".sd-light-section .sp[data-section='chat'] .settings-community-links__text",
    ],
  },
  {
    id: 'settings-visibility-final-layer',
    file: 'src/app/styles/settings-visibility-final.css',
    description: 'The final settings visibility layer keeps only active home and child-page decisions after older readability passes have been folded down.',
    patterns: [
      'Settings visibility final layer',
      'loads last',
      'v0.4.2 tone parity: all settings tones share one shell and home rhythm',
      '--settings-concept-ink: var(--nx-settings-ink);',
      '--settings-concept-line-soft: var(--nx-settings-line-soft);',
      'width: min(340px, calc(100vw - 28px));',
      'height: min(720px, calc(100vh - 42px));',
      '.sd-night.sd-home',
      '.sd-day.sd-home',
      '.sd-warm.sd-home',
      '.sd-home .settings-home-card[data-trust-group',
      '--settings-trust-trace: var(--nx-settings-track-trust);',
      'settings-appearance-switch',
      'border-bottom: 1px solid var(--settings-concept-line-soft);',
      'v0.4.2 settings child-page unity pass',
      '.sd-section .sp.sp .sphd',
      'min-height: 48px;',
      'border-bottom: 1px solid var(--nx-settings-line-soft);',
      '.sd-section .sp.sp .settings-page__back',
      'width: var(--nx-settings-control-height-small);',
      '.sd-section .sp.sp .sph h4',
      'font-size: 13px;',
      '.sd-section .sp.sp :is(.settings-section, .settings-mini-group, .settings-drawer__card, .settings-speech-config-section)',
      '.sd-section .sda',
      'background: var(--nx-settings-footer-surface);',
    ],
  },
  {
    id: 'settings-visual-system-layer',
    file: 'src/app/styles/settings-visual-system.css',
    description: 'v0.4.2 settings child pages share one Nexus visual system across themes and controls.',
    patterns: [
      'Nexus settings visual system',
      '--nx-settings-control-height: 30px;',
      '--nx-settings-field-height: 32px;',
      '--nx-settings-icon-size: 18px;',
      '--nx-settings-segment-height: 28px;',
      '--nx-settings-footer-height: 36px;',
      '--nx-settings-track-trust',
      '--nx-settings-track-memory',
      '--nx-settings-track-desktop',
      '--nx-settings-track-permission',
      '--nx-settings-track-appearance',
      '.sd-night',
      '.sd-day',
      '.sd-warm',
      '.sb-night',
      '.sb-day',
      '.sb-warm',
      '--nx-settings-footer-surface',
      '.sd-section .sp.sp',
      'input:not([type=\'checkbox\']):not([type=\'radio\']):not([type=\'range\']):not([type=\'file\'])',
      '.settings-form-row__validation',
      '.settings-test-result.is-error',
      '.settings-toggle input:checked',
      '.onboarding-region-tabs',
      '.onboarding-relationship__options',
      '.settings-sprite-preview__states',
      '.settings-companion-state-preview__states',
      '--nx-settings-segment-surface',
      '--nx-settings-segment-active',
      '.settings-choice-card.is-active',
      '.settings-danger-button',
      '.sb .confirm-dialog-card',
      '.sb .confirm-dialog-card__confirm.is-danger',
    ],
  },
  {
    id: 'focus-visible-behavior',
    file: 'src/app/styles/settings-home.css',
    description: 'Settings keeps keyboard focus visible on repeated controls.',
    patterns: [
      ':focus-visible',
      '.settings-home-card:focus-visible',
      '.settings-appearance-switch__option:focus-visible',
    ],
  },
]

function readProjectFile(root, file) {
  const fullPath = join(root, file)
  if (!existsSync(fullPath)) return null
  return readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n')
}

function readProjectFiles(root, files) {
  return new Map(files.map((file) => [file, readProjectFile(root, file)]))
}

function findMissingFiles(files) {
  return [...files.entries()]
    .filter(([, text]) => text == null)
    .map(([file]) => file)
}

function findMissingContracts(files) {
  const missing = []
  for (const contract of REQUIRED_CONTRACTS) {
    const text = files.get(contract.file)
    if (text == null) continue
    const missingPatterns = contract.patterns.filter((pattern) => !text.includes(pattern))
    if (missingPatterns.length) {
      missing.push({
        id: contract.id,
        file: contract.file,
        description: contract.description,
        missingPatterns,
      })
    }
  }
  return missing
}

function findForbiddenPatterns(files) {
  const matches = []
  for (const rule of FORBIDDEN_SOURCE_PATTERNS) {
    for (const file of rule.files) {
      const text = files.get(file)
      if (text == null) continue
      const foundPatterns = rule.patterns.filter((pattern) => text.includes(pattern))
      if (foundPatterns.length) {
        matches.push({
          id: rule.id,
          file,
          description: rule.description,
          foundPatterns,
        })
      }
    }
  }
  return matches
}

export function findSettingsStyleImportOrderIssues(entryText) {
  const styleImports = [...entryText.matchAll(/^import ['"](.\/styles\/settings[^'"]*\.css)['"]$/gm)]
    .map((match) => match[1])
  const missingImports = SETTINGS_STYLE_IMPORT_ORDER.filter((importPath) => !styleImports.includes(importPath))
  if (missingImports.length) {
    return []
  }

  const orderedIndexes = SETTINGS_STYLE_IMPORT_ORDER.map((importPath) => styleImports.indexOf(importPath))
  const orderChanged = orderedIndexes.some((index, position) => position > 0 && index < orderedIndexes[position - 1])
  const finalLayer = './styles/settings-product-reference-final.css'
  const finalLayerIndex = styleImports.indexOf(finalLayer)
  const finalLayerNotLast = finalLayerIndex !== styleImports.length - 1

  if (!orderChanged && !finalLayerNotLast) {
    return []
  }

  return [{
    id: 'settings-style-import-order',
    file: 'src/app/settingsDrawerEntry.ts',
    expectedOrder: SETTINGS_STYLE_IMPORT_ORDER,
    actualOrder: styleImports,
  }]
}

export function findDuplicateContractPatterns(contracts = REQUIRED_CONTRACTS) {
  const duplicates = []
  for (const contract of contracts) {
    const repeatedPatterns = []
    const seenPatterns = new Set()
    for (const pattern of contract.patterns) {
      if (seenPatterns.has(pattern) && !repeatedPatterns.includes(pattern)) {
        repeatedPatterns.push(pattern)
      }
      seenPatterns.add(pattern)
    }
    if (repeatedPatterns.length) {
      duplicates.push({
        id: contract.id,
        file: contract.file,
        repeatedPatterns,
      })
    }
  }
  return duplicates
}

export function findVisualSystemCoverageIssues(visualSystemCss) {
  if (visualSystemCss == null) return []

  const issues = []
  for (const family of SETTINGS_VISUAL_SYSTEM_COVERAGE) {
    const missingPatterns = family.patterns.filter((pattern) => !visualSystemCss.includes(pattern))
    if (missingPatterns.length) {
      issues.push({
        id: family.id,
        file: 'src/app/styles/settings-visual-system.css',
        description: family.description,
        missingPatterns,
      })
    }
  }
  return issues
}

function countOccurrences(text, fragment) {
  return text.split(fragment).length - 1
}

function buildSummary({
  missingFiles,
  missingContracts,
  forbiddenPatterns,
  duplicateContractPatterns,
  styleImportOrderIssues,
  visualSystemCoverageIssues,
}) {
  const errors = missingFiles.length
    + missingContracts.length
    + forbiddenPatterns.length
    + duplicateContractPatterns.length
    + styleImportOrderIssues.length
    + visualSystemCoverageIssues.length
  return {
    ok: errors === 0,
    errors,
  }
}

export function buildSettingsSurfaceReport(root = ROOT) {
  const files = readProjectFiles(root, REQUIRED_FILES)
  const metadata = files.get('src/components/settingsDrawerMetadata.ts') ?? ''
  const settingsCss = files.get('src/app/styles/settings.css') ?? ''
  const homeCss = files.get('src/app/styles/settings-home.css') ?? ''
  const themesCss = files.get('src/app/styles/settings-themes.css') ?? ''
  const chatAlignedCss = files.get('src/app/styles/settings-chat-aligned.css') ?? ''
  const chatFinalCss = files.get('src/app/styles/settings-chat-final.css') ?? ''
  const chatRoleFinalCss = files.get('src/app/styles/settings-chat-role-final.css') ?? ''
  const visibilityFinalCss = files.get('src/app/styles/settings-visibility-final.css') ?? ''
  const visualSystemCss = [
    files.get('src/app/styles/settings-visual-system.css') ?? '',
    visibilityFinalCss,
  ].join('\n')
  const missingFiles = findMissingFiles(files)
  const missingContracts = findMissingContracts(files)
  const forbiddenPatterns = findForbiddenPatterns(files)
  const duplicateContractPatterns = findDuplicateContractPatterns()
  const styleImportOrderIssues = findSettingsStyleImportOrderIssues(
    files.get('src/app/settingsDrawerEntry.ts') ?? '',
  )
  const visualSystemCoverageIssues = findVisualSystemCoverageIssues(visualSystemCss)

  const report = {
    audit: 'settings-surface',
    privacy: {
      staticSourceOnly: true,
      readsRuntimeUserData: false,
    },
    checkedFiles: REQUIRED_FILES,
    checkedContracts: REQUIRED_CONTRACTS.map((contract) => contract.id),
    settingsDom: {
      trustGroupOccurrences: countOccurrences(metadata, 'SETTINGS_TRUST_SURFACE_GROUPS'),
      focusVisibleOccurrences: countOccurrences(`${settingsCss}\n${homeCss}\n${themesCss}\n${chatAlignedCss}\n${chatFinalCss}\n${chatRoleFinalCss}\n${visualSystemCss}\n${visibilityFinalCss}`, ':focus-visible'),
      compactControlTokenOccurrences: countOccurrences(settingsCss, '--settings-control-height'),
      trustTraceOccurrences: countOccurrences(homeCss, 'data-trust-group'),
      visualSystemFamilies: SETTINGS_VISUAL_SYSTEM_COVERAGE.length,
    },
    missingFiles,
    missingContracts,
    forbiddenPatterns,
    duplicateContractPatterns,
    styleImportOrderIssues,
    visualSystemCoverageIssues,
  }

  return {
    ...report,
    summary: buildSummary(report),
  }
}

export function formatSettingsSurfaceReport(report) {
  const lines = ['Settings surface audit']
  lines.push(`- checked files: ${report.checkedFiles.length}`)
  lines.push(`- checked contracts: ${report.checkedContracts.length}`)
  lines.push(`- trust group anchors: ${report.settingsDom.trustGroupOccurrences}`)
  lines.push(`- trust trace selectors: ${report.settingsDom.trustTraceOccurrences}`)
  lines.push(`- focus-visible selectors: ${report.settingsDom.focusVisibleOccurrences}`)
  lines.push(`- visual system families: ${report.settingsDom.visualSystemFamilies}`)
  lines.push('')
  lines.push(`ERROR missingFiles: ${report.missingFiles.length}`)
  lines.push(`ERROR missingContracts: ${report.missingContracts.length}`)
  lines.push(`ERROR forbiddenPatterns: ${report.forbiddenPatterns.length}`)
  lines.push(`ERROR duplicateContractPatterns: ${report.duplicateContractPatterns.length}`)
  lines.push(`ERROR styleImportOrderIssues: ${report.styleImportOrderIssues.length}`)
  lines.push(`ERROR visualSystemCoverageIssues: ${report.visualSystemCoverageIssues.length}`)

  if (report.missingContracts.length) {
    lines.push('')
    for (const item of report.missingContracts) {
      lines.push(`missing contract ${item.id} in ${item.file}`)
      for (const pattern of item.missingPatterns) {
        lines.push(`  - ${pattern}`)
      }
    }
  }

  if (report.forbiddenPatterns.length) {
    lines.push('')
    for (const item of report.forbiddenPatterns) {
      lines.push(`forbidden pattern ${item.id} in ${item.file}`)
      for (const pattern of item.foundPatterns) {
        lines.push(`  - ${pattern}`)
      }
    }
  }

  if (report.duplicateContractPatterns.length) {
    lines.push('')
    for (const item of report.duplicateContractPatterns) {
      lines.push(`duplicate contract patterns ${item.id} in ${item.file}`)
      for (const pattern of item.repeatedPatterns) {
        lines.push(`  - ${pattern}`)
      }
    }
  }

  if (report.visualSystemCoverageIssues.length) {
    lines.push('')
    for (const item of report.visualSystemCoverageIssues) {
      lines.push(`missing visual system coverage ${item.id} in ${item.file}`)
      for (const pattern of item.missingPatterns) {
        lines.push(`  - ${pattern}`)
      }
    }
  }

  if (report.styleImportOrderIssues.length) {
    lines.push('')
    for (const item of report.styleImportOrderIssues) {
      lines.push(`style import order issue ${item.id} in ${item.file}`)
      lines.push(`  expected: ${item.expectedOrder.join(' -> ')}`)
      lines.push(`  actual: ${item.actualOrder.join(' -> ')}`)
    }
  }

  lines.push('')
  lines.push(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  return lines.join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = buildSettingsSurfaceReport(ROOT)
  console.log(formatSettingsSurfaceReport(report))
  process.exitCode = report.summary.ok ? 0 : 1
}
