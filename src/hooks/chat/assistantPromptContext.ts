import type { AssistantReplyRequestOptions } from '../../features/chat/systemPromptBuilder'
import { buildBuiltInToolDescriptors } from '../../features/tools/builtInToolSchemas'
import { detectRupture } from '../../features/autonomy/ruptureDetection'
import { buildRepairGuidance } from '../../features/autonomy/repairGuidance'
import { recordGuidanceFired } from '../../features/autonomy/guidanceTelemetry'
import { detectCrisisSignal } from '../../features/safety'
import { getRememberedCrisisSignal } from '../../features/safety/crisisSecondPass.ts'
import { buildCrisisGuidance } from '../../features/safety/crisisGuidance.ts'
import { loadCallbackQueue } from '../../features/memory/callbackStore'
import type {
  AppSettings,
  ChatMessage,
  MemoryItem,
} from '../../types'

export async function loadAvailableTools(settings: AppSettings) {
  const builtInDescriptors = buildBuiltInToolDescriptors(settings)

  let mcpDescriptors: ReturnType<typeof buildBuiltInToolDescriptors> = []
  try {
    const tools = await window.desktopPet?.mcpListTools?.()
    if (Array.isArray(tools) && tools.length) {
      const pluginSkillGuides = new Map<string, string>()
      try {
        const plugins = await window.desktopPet?.pluginList?.()
        if (Array.isArray(plugins)) {
          for (const plugin of plugins) {
            if (plugin.running && plugin.skillGuide) {
              const pluginServerId = `plugin:${plugin.id}`
              pluginSkillGuides.set(pluginServerId, plugin.skillGuide)
            }
          }
        }
      } catch {
        // Plugin list unavailable — proceed without skill guides
      }

      const reservedNames = new Set(builtInDescriptors.map((t) => t.name))
      mcpDescriptors = tools
        .filter((tool) => !reservedNames.has(tool.name))
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          serverId: tool.serverId ?? '',
          inputSchema: tool.inputSchema,
          skillGuide: pluginSkillGuides.get(tool.serverId ?? '') || '',
        }))
    }
  } catch {
    // MCP bridge unavailable — proceed with built-ins only
  }

  const combined = [
    ...builtInDescriptors,
    ...mcpDescriptors,
  ]
  return combined.length ? combined : undefined
}

export function buildPendingCallbackHints(
  nextMemories: MemoryItem[],
): AssistantReplyRequestOptions['pendingCallbacks'] | undefined {
  const queue = loadCallbackQueue()
  if (!queue.length) return undefined
  const memoriesById = new Map(nextMemories.map((m) => [m.id, m]))
  const nowMs = Date.now()
  const resolved: NonNullable<AssistantReplyRequestOptions['pendingCallbacks']> = []
  for (const entry of queue) {
    const memory = memoriesById.get(entry.memoryId)
    if (!memory) continue
    const queuedMs = Date.parse(memory.createdAt)
    const daysAgo = Number.isFinite(queuedMs)
      ? Math.max(0, (nowMs - queuedMs) / (24 * 60 * 60 * 1000))
      : 0
    resolved.push({
      memoryId: entry.memoryId,
      content: memory.content.slice(0, 240),
      daysAgo,
    })
  }
  return resolved.length ? resolved : undefined
}

export function buildRepairGuidancePromptText({
  nextMessages,
  currentSettings,
}: {
  nextMessages: ChatMessage[]
  currentSettings: AppSettings
}) {
  const userMessages = nextMessages.filter((m) => m.role === 'user')
  const lastUser = userMessages[userMessages.length - 1]
  if (!lastUser?.content) return ''
  const priorUserMessages = userMessages
    .slice(0, -1)
    .slice(-3)
    .map((m) => m.content)
  const result = detectRupture(lastUser.content, currentSettings.uiLanguage, {
    priorUserMessages,
  })
  if (result.kind !== null) {
    recordGuidanceFired({
      kind: `rupture:${result.kind}` as const,
      beforeValence: null,
    })
  }
  return buildRepairGuidance({
    uiLanguage: currentSettings.uiLanguage,
    ruptureKind: result.kind,
  })
}

export function buildCrisisGuidancePromptText({
  nextMessages,
  currentSettings,
}: {
  nextMessages: ChatMessage[]
  currentSettings: AppSettings
}) {
  const lastUser = [...nextMessages]
    .reverse()
    .find((m) => m.role === 'user')
  if (!lastUser?.content || typeof lastUser.content !== 'string') {
    return ''
  }
  const signal = getRememberedCrisisSignal(lastUser.content, currentSettings.uiLanguage)
    ?? detectCrisisSignal(lastUser.content, currentSettings.uiLanguage)
  return buildCrisisGuidance({ signal, uiLanguage: currentSettings.uiLanguage })
}
