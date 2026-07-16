import { memo, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { appendIdToCsvList } from '../integrations/allowlists'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction'
import { displaySecretInputValue, isVaultRefString } from '../../lib/keyVaultBridge'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { ConfirmFn } from '../../components/useConfirm'
import type {
  AppSettings,
  InspectableIntegrationModuleId,
  IntegrationInspectResponse,
  IntegrationRuntimeModuleState,
  McpServerConfig,
  UiLanguage,
} from '../../types'
import {
  SettingsV3Disclosure,
  SettingsV3Empty,
  SettingsV3Field,
  SettingsV3Notice,
  SettingsV3Page,
  SettingsV3Row,
  SettingsV3Section,
  SettingsV3Switch,
  SettingsV3Toolbar,
} from './SettingsV3Primitives'
import './integrations-section-v3.css'

type Props = {
  active: boolean
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  uiLanguage: UiLanguage
  confirm: ConfirmFn
}

type PairingRequest = { senderId: string; name: string; code: string; createdAt: number }

export const IntegrationsSectionV3 = memo(function IntegrationsSectionV3({ active, draft, setDraft, uiLanguage, confirm }: Props) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1], params?: Record<string, string>) => pickTranslatedUiText(uiLanguage, key, params)
  const [inspection, setInspection] = useState<IntegrationInspectResponse | null>(null)
  const [inspectionLoading, setInspectionLoading] = useState(false)
  const [inspectionError, setInspectionError] = useState('')
  const [telegramPairing, setTelegramPairing] = useState<PairingRequest[]>([])
  const [discordPairing, setDiscordPairing] = useState<PairingRequest[]>([])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    void window.desktopPet?.telegramPairingList?.().then((items) => { if (!cancelled) setTelegramPairing(items) }).catch(() => {})
    void window.desktopPet?.discordPairingList?.().then((items) => { if (!cancelled) setDiscordPairing(items) }).catch(() => {})
    const offTelegram = window.desktopPet?.subscribeTelegramPairing?.((request) => setTelegramPairing((items) => [...items.filter((item) => item.senderId !== request.senderId), request]))
    const offDiscord = window.desktopPet?.subscribeDiscordPairing?.((request) => setDiscordPairing((items) => [...items.filter((item) => item.senderId !== request.senderId), request]))
    return () => { cancelled = true; offTelegram?.(); offDiscord?.() }
  }, [active])

  useEffect(() => {
    if (!active || !window.desktopPet?.inspectIntegrations) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      setInspectionLoading(true)
      setInspectionError('')
      void window.desktopPet!.inspectIntegrations({
        mcpServers: draft.mcpServers,
        minecraftIntegrationEnabled: draft.minecraftIntegrationEnabled,
        minecraftServerAddress: draft.minecraftServerAddress,
        minecraftServerPort: draft.minecraftServerPort,
        minecraftUsername: draft.minecraftUsername,
        factorioIntegrationEnabled: draft.factorioIntegrationEnabled,
        factorioServerAddress: draft.factorioServerAddress,
        factorioServerPort: draft.factorioServerPort,
        factorioUsername: draft.factorioUsername,
      }).then((result) => { if (!cancelled) setInspection(result) })
        .catch((error) => { if (!cancelled) setInspectionError(getRedactedLogErrorMessage(error)) })
        .finally(() => { if (!cancelled) setInspectionLoading(false) })
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [active, draft.factorioIntegrationEnabled, draft.factorioServerAddress, draft.factorioServerPort, draft.factorioUsername, draft.mcpServers, draft.minecraftIntegrationEnabled, draft.minecraftServerAddress, draft.minecraftServerPort, draft.minecraftUsername])

  if (!active) return null

  const runtime = (id: InspectableIntegrationModuleId) => inspection?.modules.find((item) => item.id === id) ?? null
  const statusLabel = (state: IntegrationRuntimeModuleState['status'] | undefined) => {
    if (state === 'ready') return ti('settings.integrations.status.ready')
    if (state === 'configured') return ti('settings.integrations.status.configured')
    if (state === 'disabled') return ti('settings.integrations.status.disabled')
    if (state === 'error') return ti('settings.integrations.status.needs_repair')
    return inspectionLoading ? ti('settings.integrations.pending') : ti('settings.integrations.status.setup')
  }
  const hint = (item: IntegrationRuntimeModuleState | null) => {
    if (!item) return inspectionLoading ? ti('settings.integrations.hint.refreshing_probe') : ti('settings.integrations.hint.waiting_probe')
    if (item.status === 'ready') return ti('settings.integrations.hint.ready')
    if (item.status === 'error') return ti('settings.integrations.hint.error')
    if (item.status === 'configured') return item.id === 'mcp' ? ti('settings.integrations.hint.mcp_configured') : ti('settings.integrations.hint.configured')
    return ti('settings.integrations.hint.default')
  }
  const generatedAt = inspection?.generatedAt ? inspection.generatedAt.replace('T', ' ').slice(0, 19) : ti('settings.integrations.no_timestamp')

  const evidence = (id: InspectableIntegrationModuleId) => {
    const item = runtime(id)
    return (
      <SettingsV3Notice tone={item?.status === 'error' ? 'error' : item?.status === 'ready' ? 'success' : 'info'} title={`${statusLabel(item?.status)} · ${generatedAt}`}>
        {item?.id === 'mcp'
          ? `${item.command || ti('settings.integrations.command_missing')} · ${item.commandResolvedPath || ti('settings.integrations.not_found')}`
          : item?.endpoint
            ? `${item.endpoint.host}:${item.endpoint.port} · ${item.endpoint.message}${item.endpoint.latencyMs != null ? ` (${item.endpoint.latencyMs}ms)` : ''}`
            : item?.note || hint(item)}
      </SettingsV3Notice>
    )
  }

  const resolvePairing = (channel: 'telegram' | 'discord', request: PairingRequest, approve: boolean) => {
    if (approve) {
      setDraft((prev) => channel === 'telegram'
        ? {
            ...prev,
            telegramAllowedChatIds: appendIdToCsvList(prev.telegramAllowedChatIds, request.senderId),
            ...(Number(request.senderId) > 0 ? { ownerTelegramChatIds: appendIdToCsvList(prev.ownerTelegramChatIds, request.senderId) } : {}),
          }
        : { ...prev, discordAllowedChannelIds: appendIdToCsvList(prev.discordAllowedChannelIds, request.senderId) })
    }
    if (channel === 'telegram') {
      setTelegramPairing((items) => items.filter((item) => item.senderId !== request.senderId))
      void window.desktopPet?.telegramPairingResolve?.({ senderId: request.senderId })
    } else {
      setDiscordPairing((items) => items.filter((item) => item.senderId !== request.senderId))
      void window.desktopPet?.discordPairingResolve?.({ senderId: request.senderId })
    }
  }

  const pairingList = (channel: 'telegram' | 'discord', requests: PairingRequest[]) => requests.length ? (
    <div>
      {requests.map((request) => (
        <SettingsV3Row key={request.senderId} label={request.name || request.senderId} hint={`${request.senderId} · ${ti('settings.integrations.pairing.code')} ${request.code}`}>
          <SettingsV3Toolbar>
            <button type="button" onClick={() => resolvePairing(channel, request, true)}>{ti('settings.integrations.pairing.approve')}</button>
            <button type="button" onClick={() => resolvePairing(channel, request, false)}>{ti('settings.integrations.pairing.dismiss')}</button>
          </SettingsV3Toolbar>
        </SettingsV3Row>
      ))}
    </div>
  ) : <SettingsV3Empty title={ti('settings.integrations.pairing.empty')} />

  const updateMcp = (id: string, patch: Partial<McpServerConfig>) => setDraft((prev) => ({ ...prev, mcpServers: prev.mcpServers.map((server) => server.id === id ? { ...server, ...patch } : server) }))
  const addMcp = () => setDraft((prev) => ({ ...prev, mcpServers: [...prev.mcpServers, { id: `mcp-${crypto.randomUUID().slice(0, 8)}`, label: '', command: '', args: '', enabled: true }] }))
  const removeMcp = async (server: McpServerConfig) => {
    const accepted = await confirm({
      title: ti('settings.integrations.mcp.remove_server'),
      message: `${ti('settings.integrations.mcp.remove_server')}: ${server.label || server.command || ti('settings.integrations.mcp.unnamed_server')}`,
      confirmLabel: ti('settings.integrations.mcp.remove_server'),
      tone: 'danger',
    })
    if (accepted) setDraft((prev) => ({ ...prev, mcpServers: prev.mcpServers.filter((item) => item.id !== server.id) }))
  }

  const game = (kind: 'minecraft' | 'factorio') => {
    const minecraft = kind === 'minecraft'
    const title = minecraft ? 'Minecraft' : 'Factorio'
    const enabled = minecraft ? draft.minecraftIntegrationEnabled : draft.factorioIntegrationEnabled
    const address = minecraft ? draft.minecraftServerAddress : draft.factorioServerAddress
    const port = minecraft ? draft.minecraftServerPort : draft.factorioServerPort
    const username = minecraft ? draft.minecraftUsername : draft.factorioUsername
    return (
      <SettingsV3Disclosure title={title} description={hint(runtime(kind))}>
        <SettingsV3Row label={ti('settings.integrations.enable_game', { name: title })} meta={statusLabel(runtime(kind)?.status)}>
          <SettingsV3Switch label={title} checked={enabled} onChange={(value) => setDraft((prev) => minecraft ? { ...prev, minecraftIntegrationEnabled: value } : { ...prev, factorioIntegrationEnabled: value })} />
        </SettingsV3Row>
        <SettingsV3Field label={ti('settings.integrations.server_address')}><input value={address} placeholder={ti('settings.integrations.address_example')} onChange={(event) => setDraft((prev) => minecraft ? { ...prev, minecraftServerAddress: event.target.value } : { ...prev, factorioServerAddress: event.target.value })} /></SettingsV3Field>
        <SettingsV3Field label={ti('settings.integrations.port')}><input type="number" min="1" max="65535" value={port} onChange={(event) => { const next = Math.min(65535, Math.max(1, Number(event.target.value) || (minecraft ? 25565 : 34197))); setDraft((prev) => minecraft ? { ...prev, minecraftServerPort: next } : { ...prev, factorioServerPort: next }) }} /></SettingsV3Field>
        <SettingsV3Field label={ti('settings.integrations.identity')}><input value={username} placeholder={ti('settings.integrations.identity_example')} onChange={(event) => setDraft((prev) => minecraft ? { ...prev, minecraftUsername: event.target.value } : { ...prev, factorioUsername: event.target.value })} /></SettingsV3Field>
        {evidence(kind)}
      </SettingsV3Disclosure>
    )
  }

  const messenger = (channel: 'telegram' | 'discord') => {
    const telegram = channel === 'telegram'
    const title = telegram ? 'Telegram' : 'Discord'
    const enabled = telegram ? draft.telegramIntegrationEnabled : draft.discordIntegrationEnabled
    const token = telegram ? draft.telegramBotToken : draft.discordBotToken
    const tokenValue = displaySecretInputValue(token)
    const tokenState = isVaultRefString(token) || token ? ti('settings.integrations.status.configured') : ti('settings.integrations.status.setup')
    return (
      <SettingsV3Disclosure title={title} description={`${enabled ? ti('settings.integrations.module_enabled') : ti('settings.integrations.module_disabled')} · ${tokenState}`}>
        <SettingsV3Row label={telegram ? ti('settings.integrations.telegram.enable') : ti('settings.integrations.discord.enable')} meta={statusLabel(runtime(channel)?.status)}>
          <SettingsV3Switch label={title} checked={enabled} onChange={(value) => setDraft((prev) => telegram ? { ...prev, telegramIntegrationEnabled: value } : { ...prev, discordIntegrationEnabled: value })} />
        </SettingsV3Row>
        <SettingsV3Field label={telegram ? ti('settings.integrations.telegram.bot_token') : ti('settings.integrations.discord.bot_token')} hint={tokenState}>
          <input type="password" value={tokenValue} placeholder={tokenState} onChange={(event) => setDraft((prev) => telegram ? { ...prev, telegramBotToken: event.target.value } : { ...prev, discordBotToken: event.target.value })} />
        </SettingsV3Field>
        <SettingsV3Field label={telegram ? ti('settings.integrations.telegram.allowed_chats') : ti('settings.integrations.discord.allowed_channels')}>
          <input value={telegram ? draft.telegramAllowedChatIds : draft.discordAllowedChannelIds} onChange={(event) => setDraft((prev) => telegram ? { ...prev, telegramAllowedChatIds: event.target.value } : { ...prev, discordAllowedChannelIds: event.target.value })} />
        </SettingsV3Field>
        <SettingsV3Field label={telegram ? ti('settings.integrations.telegram.owner_chats') : ti('settings.integrations.discord.owner_users')}>
          <input value={telegram ? draft.ownerTelegramChatIds : draft.ownerDiscordUserIds} onChange={(event) => setDraft((prev) => telegram ? { ...prev, ownerTelegramChatIds: event.target.value } : { ...prev, ownerDiscordUserIds: event.target.value })} />
        </SettingsV3Field>
        <SettingsV3Row label={telegram ? ti('settings.integrations.telegram.announce_incoming') : ti('settings.integrations.discord.announce_incoming')}>
          <SettingsV3Switch label={`${title} announce`} checked={telegram ? draft.telegramAnnounceIncomingEnabled : draft.discordAnnounceIncomingEnabled} onChange={(value) => setDraft((prev) => telegram ? { ...prev, telegramAnnounceIncomingEnabled: value } : { ...prev, discordAnnounceIncomingEnabled: value })} />
        </SettingsV3Row>
        <SettingsV3Row label={telegram ? ti('settings.integrations.telegram.announce_preview') : ti('settings.integrations.discord.announce_preview')}>
          <SettingsV3Switch label={`${title} preview`} disabled={telegram ? !draft.telegramAnnounceIncomingEnabled : !draft.discordAnnounceIncomingEnabled} checked={telegram ? draft.telegramAnnounceMessagePreview : draft.discordAnnounceMessagePreview} onChange={(value) => setDraft((prev) => telegram ? { ...prev, telegramAnnounceMessagePreview: value } : { ...prev, discordAnnounceMessagePreview: value })} />
        </SettingsV3Row>
        <SettingsV3Row label={telegram ? ti('settings.integrations.telegram.auto_reply') : ti('settings.integrations.discord.auto_reply')}>
          <SettingsV3Switch label={`${title} auto reply`} checked={telegram ? draft.telegramAutoReplyEnabled : draft.discordAutoReplyEnabled} onChange={(value) => setDraft((prev) => telegram ? { ...prev, telegramAutoReplyEnabled: value } : { ...prev, discordAutoReplyEnabled: value })} />
        </SettingsV3Row>
        {telegram ? (
          <SettingsV3Field label={ti('settings.integrations.telegram.voice_reply_mode')}>
            <select value={draft.telegramVoiceReplyMode} disabled={!draft.telegramAutoReplyEnabled} onChange={(event) => setDraft((prev) => ({ ...prev, telegramVoiceReplyMode: event.target.value as AppSettings['telegramVoiceReplyMode'] }))}>
              <option value="off">{ti('settings.integrations.telegram.voice_reply_mode.off')}</option><option value="always">{ti('settings.integrations.telegram.voice_reply_mode.always')}</option><option value="inbound">{ti('settings.integrations.telegram.voice_reply_mode.inbound')}</option>
            </select>
          </SettingsV3Field>
        ) : (
          <SettingsV3Row label={ti('settings.integrations.discord.voice_reply')}>
            <SettingsV3Switch label={ti('settings.integrations.discord.voice_reply')} disabled={!draft.discordAutoReplyEnabled} checked={draft.discordVoiceReplyEnabled} onChange={(discordVoiceReplyEnabled) => setDraft((prev) => ({ ...prev, discordVoiceReplyEnabled }))} />
          </SettingsV3Row>
        )}
        <SettingsV3Field label={ti('settings.integrations.pairing.title')} hint={ti('settings.integrations.pairing.hint')}>
          {pairingList(channel, telegram ? telegramPairing : discordPairing)}
        </SettingsV3Field>
        {evidence(channel)}
      </SettingsV3Disclosure>
    )
  }

  return (
    <SettingsV3Page>
      {inspectionError ? <SettingsV3Notice tone="error" title={ti('settings.integrations.status.needs_repair')} announce>{inspectionError}</SettingsV3Notice> : (
        <SettingsV3Notice title={inspectionLoading ? ti('settings.integrations.refreshing_state') : ti('settings.integrations.runtime_wired')}>{generatedAt}</SettingsV3Notice>
      )}

      <SettingsV3Section title={ti('settings.integrations.title')} description={ti('settings.integrations.note')}>
        <div className="settings-v3-integration-status-list">
          <SettingsV3Row label="MCP" hint={hint(runtime('mcp'))} meta={statusLabel(runtime('mcp')?.status)} />
          <SettingsV3Row label="Minecraft" hint={hint(runtime('minecraft'))} meta={statusLabel(runtime('minecraft')?.status)} />
          <SettingsV3Row label="Factorio" hint={hint(runtime('factorio'))} meta={statusLabel(runtime('factorio')?.status)} />
          <SettingsV3Row label="Telegram" hint={hint(runtime('telegram'))} meta={statusLabel(runtime('telegram')?.status)} />
          <SettingsV3Row label="Discord" hint={hint(runtime('discord'))} meta={statusLabel(runtime('discord')?.status)} />
        </div>
      </SettingsV3Section>

      <SettingsV3Disclosure title={ti('settings.integrations.mcp.title')} description={ti('settings.integrations.mcp.note')}>
        <SettingsV3Toolbar><button type="button" onClick={addMcp}>{ti('settings.integrations.mcp.add_server')}</button></SettingsV3Toolbar>
        {draft.mcpServers.length ? draft.mcpServers.map((server) => (
          <div className="settings-v3-editor" key={server.id}>
            <SettingsV3Row label={server.label || server.command || ti('settings.integrations.mcp.unnamed_server')} meta={server.enabled ? ti('settings.integrations.module_enabled') : ti('settings.integrations.module_disabled')} />
            <SettingsV3Row label={ti('settings.integrations.mcp.server_enabled')}><SettingsV3Switch label={ti('settings.integrations.mcp.server_enabled')} checked={server.enabled} onChange={(enabled) => updateMcp(server.id, { enabled })} /></SettingsV3Row>
            <SettingsV3Field label={ti('settings.integrations.mcp.server_label')}><input value={server.label} onChange={(event) => updateMcp(server.id, { label: event.target.value })} /></SettingsV3Field>
            <SettingsV3Field label={ti('settings.integrations.launch_command')}><input value={server.command} placeholder="npx @modelcontextprotocol/server-filesystem" onChange={(event) => updateMcp(server.id, { command: event.target.value })} /></SettingsV3Field>
            <SettingsV3Field label={ti('settings.integrations.launch_args_label')}><textarea rows={3} value={server.args} onChange={(event) => updateMcp(server.id, { args: event.target.value })} /></SettingsV3Field>
            <SettingsV3Toolbar><button type="button" className="is-danger" onClick={() => void removeMcp(server)}>{ti('settings.integrations.mcp.remove_server')}</button></SettingsV3Toolbar>
          </div>
        )) : <SettingsV3Empty title={ti('settings.integrations.mcp.next_step')} />}
        {evidence('mcp')}
      </SettingsV3Disclosure>

      {game('minecraft')}
      {game('factorio')}
      {messenger('telegram')}
      {messenger('discord')}
    </SettingsV3Page>
  )
})
