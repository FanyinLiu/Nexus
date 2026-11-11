// @ts-nocheck
import { BrowserWindow, dialog, shell } from 'electron'
import { mainT } from '../mainMessages.js'
import { searchWeb } from './webSearch.js'
import { lookupWeatherByLocation } from './weatherTool.js'
import { normalizeExternalUrl } from './toolRegistryUtils.js'
import { resolveVaultRefsForSender } from '../services/vaultRefs.js'

function normalizeRendererToolPolicy(policy) {
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
    throw new Error(mainT('tool.disabled', { tool: toolDefinition.label() }))
  }

  return policy
}

async function openExternalLinkWithShell(payload, context = {}) {
  const url = normalizeExternalUrl(payload?.url)
  const dialogOptions = {
    type: 'question',
    buttons: [mainT('tool.openLink.open'), mainT('tool.openLink.cancel')],
    defaultId: 1,
    cancelId: 1,
    message: mainT('tool.openLink.title'),
    detail: url,
  }
  const { response } = context.sourceWindow
    ? await dialog.showMessageBox(context.sourceWindow, dialogOptions)
    : await dialog.showMessageBox(dialogOptions)
  if (response !== 0) {
    throw new Error(mainT('tool.openLink.cancelled'))
  }
  await shell.openExternal(url)
  return {
    ok: true,
    url,
    message: mainT('tool.openLink.opened', { url }),
  }
}

const BUILT_IN_TOOL_REGISTRY = Object.freeze({
  web_search: {
    id: 'web_search',
    label: () => mainT('tool.webSearch.label'),
    riskLevel: 'low',
    secretFields: ['apiKey'],
    handler: (payload) => searchWeb(payload),
  },
  weather_lookup: {
    id: 'weather_lookup',
    label: () => mainT('tool.weatherLookup.label'),
    riskLevel: 'low',
    handler: (payload) => lookupWeatherByLocation(payload?.location, payload?.fallbackLocation, payload?.locale),
  },
  open_external_link: {
    id: 'open_external_link',
    label: () => mainT('tool.openExternalLink.label'),
    riskLevel: 'medium',
    handler: (payload, context) => openExternalLinkWithShell(payload, context),
  },
})

export async function invokeRegisteredTool(event, toolId, payload = {}) {
  const toolDefinition = BUILT_IN_TOOL_REGISTRY[toolId]
  if (!toolDefinition) {
    throw new Error(mainT('tool.unknown', { tool: toolId }))
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
