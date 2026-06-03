import { BrowserWindow, dialog, shell } from 'electron'
import { searchWeb } from './webSearch.js'
import { lookupWeatherByLocation } from './weatherTool.js'
import { normalizeExternalUrl } from './toolRegistryUtils.js'
import { resolveVaultRefsForSender } from '../services/vaultRefs.js'

export function normalizeRendererToolPolicy(policy) {
  if (!policy || typeof policy !== 'object') {
    return {
      enabled: true,
      requiresConfirmation: false,
    }
  }

  return {
    enabled: policy.enabled !== false,
    requiresConfirmation: policy.requiresConfirmation === true,
  }
}

function assertRendererToolAllowed(toolDefinition, payload) {
  const policy = normalizeRendererToolPolicy(payload?.policy)

  if (!policy.enabled) {
    throw new Error(`${toolDefinition.label} 已在当前设置中禁用。`)
  }

  return policy
}

async function openExternalLinkWithShell(payload, context = {}) {
  const url = normalizeExternalUrl(payload?.url)
  const dialogOptions = {
    type: 'question',
    buttons: ['打开', '取消'],
    defaultId: 1,
    cancelId: 1,
    message: '即将打开外部链接',
    detail: url,
  }
  const { response } = context.sourceWindow
    ? await dialog.showMessageBox(context.sourceWindow, dialogOptions)
    : await dialog.showMessageBox(dialogOptions)
  if (response !== 0) {
    throw new Error('已取消打开外部链接。')
  }
  await shell.openExternal(url)
  return {
    ok: true,
    url,
    message: `已在系统浏览器中打开 ${url}`,
  }
}

export const BUILT_IN_TOOL_REGISTRY = Object.freeze({
  web_search: {
    id: 'web_search',
    label: '网页搜索',
    riskLevel: 'low',
    secretFields: ['apiKey'],
    handler: (payload) => searchWeb(payload),
  },
  weather_lookup: {
    id: 'weather_lookup',
    label: '天气查询',
    riskLevel: 'low',
    handler: (payload) => lookupWeatherByLocation(payload?.location, payload?.fallbackLocation),
  },
  open_external_link: {
    id: 'open_external_link',
    label: '打开外部链接',
    riskLevel: 'medium',
    handler: (payload, context) => openExternalLinkWithShell(payload, context),
  },
})

export async function invokeRegisteredTool(event, toolId, payload = {}) {
  const toolDefinition = BUILT_IN_TOOL_REGISTRY[toolId]
  if (!toolDefinition) {
    throw new Error(`未知工具：${toolId}`)
  }

  const sourceWindow = BrowserWindow.fromWebContents(event.sender)
  const policy = assertRendererToolAllowed(toolDefinition, payload)

  console.info(`[tool:${toolDefinition.id}] invoke`, {
    riskLevel: toolDefinition.riskLevel,
    requiresConfirmation: policy.requiresConfirmation,
    sourceWindow: sourceWindow?.id ?? null,
  })

  const resolvedPayload = await resolveVaultRefsForSender(
    event.sender,
    payload,
    toolDefinition.secretFields ?? [],
  )

  return toolDefinition.handler(resolvedPayload, {
    sourceWindow,
    policy,
  })
}
