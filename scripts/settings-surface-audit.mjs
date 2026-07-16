#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FORBIDDEN_SOURCE_PATTERNS,
  REQUIRED_FILES,
  SETTINGS_STYLE_BUNDLES,
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
      '--settings-body-font-size: 12px;',
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
      '.sd-warm-section .settings-relationship__chip',
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
    file: 'src/app/settingsStyleBundles.ts',
    description: 'The app-layer lazy settings entry loads four ordered CSS bundles before the settings drawer can paint.',
    patterns: [
      "import('./settingsStylesFoundation')",
      "import('./settingsStylesTheme')",
      "import('./settingsStylesSurface')",
      "import('./settingsStylesFinal')",
      'for (const bundle of SETTINGS_STYLE_BUNDLES)',
      'await bundle.load()',
    ],
  },
  {
    id: 'settings-theme-conditional-tail',
    file: 'src/app/settingsStylesTheme.ts',
    description: 'The shared theme loads first, the legacy tail is fallback-only, and chat alignment remains the final theme layer.',
    patterns: [
      "import './styles/settings-themes.css'",
      "get('uiV2') === '0'",
      "await import('./settingsStylesThemeLegacy')",
      "await import('./settingsStylesThemeAligned')",
    ],
  },
  {
    id: 'settings-legacy-product-reference-boundary',
    file: 'src/app/settingsDrawerEntry.ts',
    description: 'The full product reference is loaded only for the explicit legacy settings shell after shared styles settle.',
    patterns: [
      "new URLSearchParams(window.location.search).get('uiV2') === '0'",
      "await import('./settingsStylesLegacyProductReference')",
    ],
  },
  {
    id: 'settings-legacy-product-reference-module',
    file: 'src/app/settingsStylesLegacyProductReference.ts',
    description: 'The conditional legacy module owns the full fallback product reference stylesheet.',
    patterns: [
      "import './styles/settings-product-reference-final.css'",
    ],
  },
  {
    id: 'settings-modern-product-reference-bridge',
    file: 'src/app/styles/settings-product-reference-modern-bridge.css',
    description: 'Modern settings keeps only the narrow outer-shell bounds shared with the legacy product reference.',
    patterns: [
      'Modern settings only needs the narrow outer-shell bounds',
      '@media (max-width: 679px)',
      'width: min(392px, calc(100vw - 16px));',
      'height: min(784px, calc(100vh - 16px));',
    ],
  },
  {
    id: 'settings-chat-final-parity-layer',
    file: 'src/app/styles/settings-chat-final.css',
    description: 'The final settings layer owns only the shared light shell, home rhythm, child-page frame, and footer parity.',
    patterns: [
      'Final chat-parity pass',
      '--settings-chat-parity-line:',
      '--settings-chat-parity-row:',
      '--settings-chat-parity-command:',
      'width: min(340px, calc(100vw - 28px));',
      'height: min(640px, calc(100vh - 48px));',
      '.sd-light.sd-home .sdb',
      '.sd-light.sd-home .settings-home-presence',
      '.sd-light.sd-home .settings-appearance-switch',
      '.sd-light.sd-home .settings-home-card',
      'min-height: 34px;',
      '.sd-light-section .sph h4:focus',
      '.sd-light-section .sdc.settings-drawer__sections',
      'padding-bottom: 104px;',
      '.sd-light.sd-home .sda',
      'background: var(--settings-chat-parity-command);',
    ],
  },
  {
    id: 'settings-v3-shared-style-boundary',
    file: 'src/features/settingsV3/settings-v3.css',
    description: 'V3 keeps only page, section, row, editor, accessibility, and responsive primitives in the shared stylesheet.',
    patterns: [
      '.settings-v3-page',
      '.settings-v3-row',
      '.settings-v3-editor',
      '@media (max-width: 719px)',
      '@media (prefers-reduced-motion: reduce)',
      '@media (forced-colors: active)',
    ],
  },
  {
    id: 'settings-v3-chat-style-boundary',
    file: 'src/features/settingsV3/ChatSectionV3.tsx',
    description: 'Chat loads its collection and chat-specific CSS only when the lazy chat section module is entered.',
    patterns: [
      "import './settings-v3-collection.css'",
      "import './chat-section-v3.css'",
    ],
  },
  {
    id: 'settings-v3-chat-section-styles',
    file: 'src/features/settingsV3/chat-section-v3.css',
    description: 'Chat-specific choice and studio layouts live outside the shared V3 primitive bundle.',
    patterns: [
      '.settings-v3-choice-grid',
      '.settings-v3-studio',
      '@media (max-width: 719px)',
    ],
  },
  {
    id: 'settings-v3-voice-style-boundary',
    file: 'src/features/settingsV3/VoiceSectionV3.tsx',
    description: 'Voice loads its provider and tuning CSS only when the lazy voice section module is entered.',
    patterns: [
      "import './voice-section-v3.css'",
    ],
  },
  {
    id: 'settings-v3-voice-section-styles',
    file: 'src/features/settingsV3/voice-section-v3.css',
    description: 'Voice-specific provider and tuning layouts live outside the shared V3 primitive bundle.',
    patterns: [
      '.settings-v3-provider',
      '.settings-v3-tuning',
      '@media (max-width: 719px)',
    ],
  },
  {
    id: 'settings-v3-collection-style-boundary',
    file: 'src/features/settingsV3/MemorySectionV3.tsx',
    description: 'Collection-heavy pages opt into the reusable collection bundle from their lazy section module.',
    patterns: [
      "import './settings-v3-collection.css'",
    ],
  },
  {
    id: 'settings-v3-collection-styles',
    file: 'src/features/settingsV3/settings-v3-collection.css',
    description: 'Collection rows, letter bodies, chips, and forced-colors focus treatment share one page-bound bundle.',
    patterns: [
      '.settings-v3-collection',
      '.settings-v3-letter-body',
      '.settings-v3-chip-line',
      '@media (forced-colors: active)',
    ],
  },
  {
    id: 'settings-v3-integrations-style-boundary',
    file: 'src/features/settingsV3/IntegrationsSectionV3.tsx',
    description: 'Integrations loads its narrow responsive adjustment only when the lazy integrations section is entered.',
    patterns: [
      "import './integrations-section-v3.css'",
    ],
  },
  {
    id: 'settings-v3-console-style-boundary',
    file: 'src/features/settingsV3/ConsoleSectionV3.tsx',
    description: 'Console loads collection plus plan and agent activity CSS only when the lazy console section is entered.',
    patterns: [
      "import './settings-v3-collection.css'",
      "import './console-section-v3.css'",
    ],
  },
  {
    id: 'settings-v3-console-section-styles',
    file: 'src/features/settingsV3/console-section-v3.css',
    description: 'Plan and agent activity surfaces live outside the global settings foundation bundle.',
    patterns: [
      'Console V3 owns plan and agent activity surfaces',
      '.settings-plan-panel',
      '.settings-agent-panel',
      '@media (max-width: 640px)',
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
      'min-height: 48px;',
      'border-bottom: 1px solid var(--nx-settings-line-soft);',
      '.sd-section .sp.sp .settings-page__back',
      'width: var(--nx-settings-control-height-small);',
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
    id: 'settings-product-final-control-layer',
    file: 'src/app/styles/settings-product-reference-final.css',
    description: 'The conditional legacy product layer owns fallback segmented, toggle, success, and child-page header treatments.',
    patterns: [
      '.sd-section .sp.sp .sphd',
      '.sd-section .sp.sp .sph h4',
      '.settings-toggle input:checked',
      '.settings-segmented-control {',
      '.settings-segmented-control__option {',
      '.settings-segmented-control__option.is-active {',
      '.settings-relationship__options',
      '.settings-test-result.is-success',
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

export function findSettingsStyleImportOrderIssues(entryText, bundleText = '', styleSources = new Map()) {
  const entryCssImports = [...entryText.matchAll(/^import ['"](.\/styles\/settings[^'"]*\.css)['"]$/gm)]
    .map((match) => match[1])
  const expectedDynamicImports = SETTINGS_STYLE_BUNDLES.map((bundle) => bundle.importPath)
  const dynamicImports = [...bundleText.matchAll(/import\(['"](\.\/settingsStyles[^'"]+)['"]\)/g)]
    .map((match) => match[1])
  const issues = []
  if (entryCssImports.length > 0) {
    issues.push({
      id: 'settings-style-static-entry',
      file: 'src/app/settingsDrawerEntry.ts',
      expectedOrder: [],
      actualOrder: entryCssImports,
    })
  }
  if (JSON.stringify(dynamicImports) !== JSON.stringify(expectedDynamicImports)) {
    issues.push({
      id: 'settings-style-bundle-order',
      file: 'src/app/settingsStyleBundles.ts',
      expectedOrder: expectedDynamicImports,
      actualOrder: dynamicImports,
    })
  }
  if (bundleText.includes('Promise.all') || !/for\s*\(const bundle of SETTINGS_STYLE_BUNDLES\)[\s\S]*await bundle\.load\(\)/.test(bundleText)) {
    issues.push({
      id: 'settings-style-sequential-loader',
      file: 'src/app/settingsStyleBundles.ts',
      expectedOrder: expectedDynamicImports,
      actualOrder: dynamicImports,
    })
  }

  const readOrderedCssImports = (module, seen = new Set()) => {
    if (seen.has(module)) return []
    seen.add(module)
    const source = styleSources.get(module) ?? ''
    const specifiers = [...source.matchAll(/(?:^import\s+['"]([^'"]+)['"]|await\s+import\(['"]([^'"]+)['"]\))/gm)]
      .map((match) => match[1] ?? match[2])
    return specifiers.flatMap((specifier) => {
      if (specifier.startsWith('./styles/settings') && specifier.endsWith('.css')) return [specifier]
      if (!specifier.startsWith('./settingsStylesTheme')) return []
      return readOrderedCssImports(`src/app/${specifier.slice(2)}.ts`, seen)
    })
  }
  const actualCssImports = SETTINGS_STYLE_BUNDLES.flatMap((bundle) => readOrderedCssImports(bundle.module))
  if (styleSources.size > 0 && JSON.stringify(actualCssImports) !== JSON.stringify(SETTINGS_STYLE_IMPORT_ORDER)) {
    issues.push({
      id: 'settings-style-import-order',
      file: 'src/app/settingsStylesFoundation.ts',
      expectedOrder: SETTINGS_STYLE_IMPORT_ORDER,
      actualOrder: actualCssImports,
    })
  }
  return issues
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
  const visibilityFinalCss = files.get('src/app/styles/settings-visibility-final.css') ?? ''
  const visualSystemCss = [
    files.get('src/app/styles/settings-visual-system.css') ?? '',
    visibilityFinalCss,
    files.get('src/app/styles/settings-product-reference-final.css') ?? '',
  ].join('\n')
  const missingFiles = findMissingFiles(files)
  const missingContracts = findMissingContracts(files)
  const forbiddenPatterns = findForbiddenPatterns(files)
  const duplicateContractPatterns = findDuplicateContractPatterns()
  const styleImportOrderIssues = findSettingsStyleImportOrderIssues(
    files.get('src/app/settingsDrawerEntry.ts') ?? '',
    files.get('src/app/settingsStyleBundles.ts') ?? '',
    files,
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
      focusVisibleOccurrences: countOccurrences(`${settingsCss}\n${homeCss}\n${themesCss}\n${chatAlignedCss}\n${chatFinalCss}\n${visualSystemCss}\n${visibilityFinalCss}`, ':focus-visible'),
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
