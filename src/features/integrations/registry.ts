import type { InspectableIntegrationModuleId } from '../../types'
import type { TranslationKey } from '../../types/i18n'

export type IntegrationModuleId =
  | InspectableIntegrationModuleId
  | 'discord'
  | 'hearing'
  | 'vision'
  | 'provider-catalog'
  | 'talk-mode'
  | 'controls-island'

export interface IntegrationModuleDescriptor {
  id: IntegrationModuleId
  inspectable: boolean
  panelId?: InspectableIntegrationModuleId
  title: TranslationKey
  badge: TranslationKey
  summary: TranslationKey
  designPattern: TranslationKey
  nextStep: TranslationKey
  references: string[]
  /**
   * If true, the module is excluded from both the inspectable and the
   * roadmap UI surfaces. The IPC handlers and service code still run —
   * this only hides the Settings card so the user doesn't see modules
   * we're not actively shipping yet. Toggle to false to re-surface.
   */
  hidden?: boolean
}

const INTEGRATION_MODULES: IntegrationModuleDescriptor[] = [
  {
    id: 'mcp',
    inspectable: true,
    panelId: 'mcp',
    title: 'integration.mcp.title',
    badge: 'integration.mcp.badge',
    summary: 'integration.mcp.summary',
    designPattern: 'integration.mcp.design_pattern',
    nextStep: 'integration.mcp.next_step',
    references: [
      'stage-ui/src/stores/mcp.ts',
      'stage-ui/src/stores/mcp-tool-bridge.ts',
      'stage-ui/src/tools/mcp.ts',
    ],
  },
  {
    id: 'minecraft',
    inspectable: true,
    panelId: 'minecraft',
    title: 'integration.minecraft.title',
    badge: 'integration.minecraft.badge',
    summary: 'integration.minecraft.summary',
    designPattern: 'integration.minecraft.design_pattern',
    nextStep: 'integration.minecraft.next_step',
    references: [
      'stage-ui/src/stores/modules/gaming-module-factory.ts',
      'stage-pages/src/pages/settings/modules/gaming-minecraft.vue',
    ],
    // Hidden from Settings UI for v0.3.x — not a focus, surface back when
    // we're ready to invest in game integrations as a real feature.
    hidden: true,
  },
  {
    id: 'factorio',
    inspectable: true,
    panelId: 'factorio',
    title: 'integration.factorio.title',
    badge: 'integration.factorio.badge',
    summary: 'integration.factorio.summary',
    designPattern: 'integration.factorio.design_pattern',
    nextStep: 'integration.factorio.next_step',
    references: [
      'stage-pages/src/pages/settings/modules/gaming-factorio.vue',
      'stage-ui/src/components/modules/GamingModuleSettings.vue',
    ],
    hidden: true,
  },
  {
    id: 'telegram',
    inspectable: true,
    panelId: 'telegram',
    title: 'integration.telegram.title',
    badge: 'integration.telegram.badge',
    summary: 'integration.telegram.summary',
    designPattern: 'integration.telegram.design_pattern',
    nextStep: 'integration.telegram.next_step',
    references: [
      'electron/services/telegramGateway.js',
      'electron/ipc/telegramIpc.js',
    ],
  },
  {
    id: 'discord',
    inspectable: true,
    panelId: 'discord',
    title: 'integration.discord.title',
    badge: 'integration.discord.badge',
    summary: 'integration.discord.summary',
    designPattern: 'integration.discord.design_pattern',
    nextStep: 'integration.discord.next_step',
    references: [
      'electron/services/discordGateway.js',
      'electron/ipc/discordIpc.js',
    ],
  },
  {
    id: 'hearing',
    inspectable: false,
    title: 'integration.hearing.title',
    badge: 'integration.hearing.badge',
    summary: 'integration.hearing.summary',
    designPattern: 'integration.hearing.design_pattern',
    nextStep: 'integration.hearing.next_step',
    references: [
      'stage-ui/src/stores/modules/hearing.ts',
      'stage-ui/src/components/scenarios/dialogs/audio-input/hearing-config.vue',
    ],
  },
  {
    id: 'vision',
    inspectable: false,
    title: 'integration.vision.title',
    badge: 'integration.vision.badge',
    summary: 'integration.vision.summary',
    designPattern: 'integration.vision.design_pattern',
    nextStep: 'integration.vision.next_step',
    references: [
      'stage-ui/src/stores/modules/vision/store.ts',
      'stage-ui/src/stores/modules/vision/orchestrator.ts',
    ],
  },
  {
    id: 'provider-catalog',
    inspectable: false,
    title: 'integration.provider-catalog.title',
    badge: 'integration.provider-catalog.badge',
    summary: 'integration.provider-catalog.summary',
    designPattern: 'integration.provider-catalog.design_pattern',
    nextStep: 'integration.provider-catalog.next_step',
    references: [
      'stage-ui/src/stores/provider-catalog.ts',
      'stage-ui/src/database/repos/providers.repo.ts',
    ],
  },
  {
    id: 'talk-mode',
    inspectable: false,
    title: 'integration.talk-mode.title',
    badge: 'integration.talk-mode.badge',
    summary: 'integration.talk-mode.summary',
    designPattern: 'integration.talk-mode.design_pattern',
    nextStep: 'integration.talk-mode.next_step',
    references: [
      'stage-ui/src/stores/speech-runtime.ts',
      'stage-ui/src/services/speech/pipeline-runtime.ts',
    ],
  },
  {
    id: 'controls-island',
    inspectable: false,
    title: 'integration.controls-island.title',
    badge: 'integration.controls-island.badge',
    summary: 'integration.controls-island.summary',
    designPattern: 'integration.controls-island.design_pattern',
    nextStep: 'integration.controls-island.next_step',
    references: [
      'stage-ui/src/stores/settings/controls-island.ts',
      'stage-layouts/src/components/Layouts/InteractiveArea/Actions/ViewControls.vue',
    ],
  },
]

export function listIntegrationModules() {
  return INTEGRATION_MODULES
}

export function getInspectableIntegrationModules() {
  return INTEGRATION_MODULES.filter((module) => module.inspectable && !module.hidden)
}

export function getRoadmapIntegrationModules() {
  return INTEGRATION_MODULES.filter((module) => !module.inspectable && !module.hidden)
}
