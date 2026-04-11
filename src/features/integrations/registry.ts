import { resolveLocalizedText } from '../../lib/uiLanguage'
import type { InspectableIntegrationModuleId, UiLanguage } from '../../types'

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
  title: {
    zhCN: string
    enUS: string
  }
  badge: {
    zhCN: string
    enUS: string
  }
  summary: {
    zhCN: string
    enUS: string
  }
  designPattern: {
    zhCN: string
    enUS: string
  }
  nextStep: {
    zhCN: string
    enUS: string
  }
  references: string[]
}

const INTEGRATION_MODULES: IntegrationModuleDescriptor[] = [
  {
    id: 'mcp',
    inspectable: true,
    panelId: 'mcp',
    title: {
      zhCN: 'MCP Host',
      enUS: 'MCP Host',
    },
    badge: {
      zhCN: '主进程桥接',
      enUS: 'Main-process bridge',
    },
    summary: {
      zhCN: '使用命令 + 参数配置形态，为 Nexus 的 MCP Host 留出稳定入口。',
      enUS: 'Uses a command + args configuration shape so Nexus can attach a stable MCP host entry point.',
    },
    designPattern: {
      zhCN: '基于 MCP store、tool bridge 与 plugin host 能力分发。',
      enUS: 'Uses an MCP store, tool bridge, and plugin-host capability routing pattern.',
    },
    nextStep: {
      zhCN: '下一步直接把主进程 MCP Host 接到工具注册表和 Doctor 里。',
      enUS: 'Next: connect a real main-process MCP host into the tool registry and Doctor.',
    },
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
    title: {
      zhCN: 'Minecraft',
      enUS: 'Minecraft',
    },
    badge: {
      zhCN: '游戏模块',
      enUS: 'Game module',
    },
    summary: {
      zhCN: '使用游戏模块工厂模式，把地址、端口、身份与运行探测收进同一张模块卡。',
      enUS: 'Uses a gaming-module factory pattern to keep endpoint, identity, and runtime probing in one card.',
    },
    designPattern: {
      zhCN: '基于游戏模块工厂与 Minecraft 模块设置页设计。',
      enUS: 'Based on gaming-module-factory and Minecraft module settings page patterns.',
    },
    nextStep: {
      zhCN: '下一步接 bot / websocket / TCP 网关，把世界状态真正带进上下文。',
      enUS: 'Next: wire a bot / websocket / TCP gateway and feed live world context into Nexus.',
    },
    references: [
      'stage-ui/src/stores/modules/gaming-module-factory.ts',
      'stage-pages/src/pages/settings/modules/gaming-minecraft.vue',
    ],
  },
  {
    id: 'factorio',
    inspectable: true,
    panelId: 'factorio',
    title: {
      zhCN: 'Factorio',
      enUS: 'Factorio',
    },
    badge: {
      zhCN: '游戏模块',
      enUS: 'Game module',
    },
    summary: {
      zhCN: '与 Minecraft 共用同一套模块结构，避免后续每个游戏重新造一套设置页。',
      enUS: 'Shares the same module structure with Minecraft to avoid rebuilding settings per game.',
    },
    designPattern: {
      zhCN: '基于 Factorio 模块设置页与统一模块配置流。',
      enUS: 'Mirrors the Factorio module page and shared module configuration flow.',
    },
    nextStep: {
      zhCN: '下一步补事件桥和上下文注入，把工厂/物流状态转成可调用能力。',
      enUS: 'Next: add an event bridge and context injection so factory/logistics state becomes callable capability.',
    },
    references: [
      'stage-pages/src/pages/settings/modules/gaming-factorio.vue',
      'stage-ui/src/components/modules/GamingModuleSettings.vue',
    ],
  },
  {
    id: 'telegram',
    inspectable: true,
    panelId: 'telegram',
    title: {
      zhCN: 'Telegram',
      enUS: 'Telegram',
    },
    badge: {
      zhCN: '消息网关',
      enUS: 'Messaging gateway',
    },
    summary: {
      zhCN: '通过 Telegram Bot API 长轮询接收消息，实现跨平台对话。',
      enUS: 'Long-poll Telegram Bot API for cross-platform messaging with your companion.',
    },
    designPattern: {
      zhCN: '基于 Bot API getUpdates 长轮询，主进程服务 + IPC 桥接。',
      enUS: 'Bot API getUpdates long-polling with main-process service and IPC bridge.',
    },
    nextStep: {
      zhCN: '配置 Bot Token 后即可双向通信，消息自动转入伴侣对话。',
      enUS: 'Configure a Bot Token to enable bidirectional messaging routed into companion chat.',
    },
    references: [
      'electron/services/telegramGateway.js',
      'electron/ipc/telegramIpc.js',
    ],
  },
  {
    id: 'discord',
    inspectable: true,
    panelId: 'discord',
    title: {
      zhCN: 'Discord',
      enUS: 'Discord',
    },
    badge: {
      zhCN: '消息网关',
      enUS: 'Messaging gateway',
    },
    summary: {
      zhCN: '通过 Discord Bot Gateway WebSocket 接收消息，实现跨平台对话。',
      enUS: 'Connect to Discord Bot Gateway via WebSocket for cross-platform messaging.',
    },
    designPattern: {
      zhCN: '基于 Discord Gateway WebSocket + REST API，主进程服务 + IPC 桥接。',
      enUS: 'Discord Gateway WebSocket + REST API with main-process service and IPC bridge.',
    },
    nextStep: {
      zhCN: '配置 Bot Token 后即可双向通信，消息自动转入伴侣对话。',
      enUS: 'Configure a Bot Token to enable bidirectional messaging routed into companion chat.',
    },
    references: [
      'electron/services/discordGateway.js',
      'electron/ipc/discordIpc.js',
    ],
  },
  {
    id: 'hearing',
    inspectable: false,
    title: {
      zhCN: 'Hearing',
      enUS: 'Hearing',
    },
    badge: {
      zhCN: '待接入',
      enUS: 'Queued',
    },
    summary: {
      zhCN: 'Hearing 模块用于收拢 Nexus 分散的 STT / VAD / 唤醒词设置。',
      enUS: 'A Hearing module to unify Nexus\u2019s scattered STT / VAD / wake-word controls.',
    },
    designPattern: {
      zhCN: '基于 hearing store 和 hearing config dialog 设计。',
      enUS: 'Based on a hearing store and config dialog pattern.',
    },
    nextStep: {
      zhCN: '把流式 STT、终稿校正、热词和唤醒词状态收敛到一个运行时 store。',
      enUS: 'Bring streaming STT, final-pass correction, hotwords, and wake-word state into one runtime store.',
    },
    references: [
      'stage-ui/src/stores/modules/hearing.ts',
      'stage-ui/src/components/scenarios/dialogs/audio-input/hearing-config.vue',
    ],
  },
  {
    id: 'vision',
    inspectable: false,
    title: {
      zhCN: 'Vision',
      enUS: 'Vision',
    },
    badge: {
      zhCN: '待接入',
      enUS: 'Queued',
    },
    summary: {
      zhCN: 'Vision 编排模块，与 Nexus 现有桌面 OCR / 截屏上下文合并。',
      enUS: 'Vision orchestration to integrate with Nexus\u2019s existing desktop OCR and screenshot context.',
    },
    designPattern: {
      zhCN: '基于 vision store、orchestrator 与 workload 分层设计。',
      enUS: 'Uses a vision store, orchestrator, and workload organization pattern.',
    },
    nextStep: {
      zhCN: '先做采集队列与负载分层，再接模型推理与工具输出。',
      enUS: 'Start with capture queues and workload layers before adding model inference and tool output.',
    },
    references: [
      'stage-ui/src/stores/modules/vision/store.ts',
      'stage-ui/src/stores/modules/vision/orchestrator.ts',
    ],
  },
  {
    id: 'provider-catalog',
    inspectable: false,
    title: {
      zhCN: 'Provider Catalog',
      enUS: 'Provider Catalog',
    },
    badge: {
      zhCN: '待接入',
      enUS: 'Queued',
    },
    summary: {
      zhCN: 'Provider catalog 模块，用于替代 Nexus 当前手填字段分散的问题。',
      enUS: 'A provider catalog to replace Nexus\u2019s scattered manual provider fields.',
    },
    designPattern: {
      zhCN: '基于 provider-catalog store 和 providers repo 设计。',
      enUS: 'Uses a provider-catalog store and providers repository pattern.',
    },
    nextStep: {
      zhCN: '先做 provider registry，再把聊天 / STT / TTS 设置迁过去。',
      enUS: 'Start with a provider registry, then migrate chat / STT / TTS settings onto it.',
    },
    references: [
      'stage-ui/src/stores/provider-catalog.ts',
      'stage-ui/src/database/repos/providers.repo.ts',
    ],
  },
  {
    id: 'talk-mode',
    inspectable: false,
    title: {
      zhCN: 'Talk Mode',
      enUS: 'Talk Mode',
    },
    badge: {
      zhCN: '待接入',
      enUS: 'Queued',
    },
    summary: {
      zhCN: '语音运行时和独立对话界面，对应 Nexus 要做的独立语音层。',
      enUS: 'Speech runtime and dedicated talk UI for Nexus\u2019s standalone voice layer.',
    },
    designPattern: {
      zhCN: '基于 speech runtime、pipeline runtime 与 talk scene 设计。',
      enUS: 'Uses speech runtime, pipeline runtime, and talk scene flow patterns.',
    },
    nextStep: {
      zhCN: '把监听 / 思考 / 朗读 / 被打断状态做成独立 Talk 浮层，而不是散在按钮上。',
      enUS: 'Turn listening / thinking / speaking / interrupted into a dedicated Talk overlay instead of scattered buttons.',
    },
    references: [
      'stage-ui/src/stores/speech-runtime.ts',
      'stage-ui/src/services/speech/pipeline-runtime.ts',
    ],
  },
  {
    id: 'controls-island',
    inspectable: false,
    title: {
      zhCN: 'Controls Island',
      enUS: 'Controls Island',
    },
    badge: {
      zhCN: '待接入',
      enUS: 'Queued',
    },
    summary: {
      zhCN: '轻量浮动控制岛，用于精简 Nexus 桌宠按钮层。',
      enUS: 'A lightweight controls island for slimming down Nexus\u2019s pet controls.',
    },
    designPattern: {
      zhCN: '基于 controls-island store 与 InteractiveArea 操作区设计。',
      enUS: 'Uses a controls-island store and InteractiveArea action region pattern.',
    },
    nextStep: {
      zhCN: '把固定、穿透、语音与设置入口继续收束成更轻的外部卡片岛。',
      enUS: 'Keep tightening pin, click-through, voice, and settings entry into a lighter external control island.',
    },
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
  return INTEGRATION_MODULES.filter((module) => module.inspectable)
}

export function getRoadmapIntegrationModules() {
  return INTEGRATION_MODULES.filter((module) => !module.inspectable)
}

export function getIntegrationText(
  language: UiLanguage,
  copy: { zhCN: string; enUS: string },
) {
  return resolveLocalizedText(language, {
    'zh-CN': copy.zhCN,
    'en-US': copy.enUS,
  })
}
