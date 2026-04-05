import { BrowserWindow, shell } from 'electron'
import { searchWeb } from './webSearch.js'
import { lookupWeatherByLocation } from './weatherTool.js'

function normalizeExternalUrl(rawUrl) {
  const trimmed = String(rawUrl ?? '').trim()
  if (!trimmed) {
    throw new Error('链接不能为空。')
  }

  const normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`
  const targetUrl = new URL(normalized)

  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    throw new Error('目前只支持打开 http 或 https 链接。')
  }

  return targetUrl.toString()
}

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

async function openExternalLinkWithShell(payload) {
  const url = normalizeExternalUrl(payload?.url)
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
    handler: (payload) => openExternalLinkWithShell(payload),
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

  return toolDefinition.handler(payload, {
    sourceWindow,
    policy,
  })
}
