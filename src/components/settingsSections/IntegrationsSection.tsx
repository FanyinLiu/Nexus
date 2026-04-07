import { memo, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { parseNumberInput } from '../settingsDrawerSupport'
import {
  getIntegrationText,
  getInspectableIntegrationModules,
  getRoadmapIntegrationModules,
  type IntegrationModuleDescriptor,
} from '../../features/integrations/registry'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type {
  AppSettings,
  InspectableIntegrationModuleId,
  IntegrationInspectResponse,
  IntegrationRuntimeModuleState,
  McpServerConfig,
  UiLanguage,
} from '../../types'

type IntegrationsSectionProps = {
  active: boolean
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  uiLanguage: UiLanguage
}

type IntegrationPanelId = InspectableIntegrationModuleId

const inspectableModules = getInspectableIntegrationModules()
const roadmapModules = getRoadmapIntegrationModules()

export const IntegrationsSection = memo(function IntegrationsSection({
  active,
  draft,
  setDraft,
  uiLanguage,
}: IntegrationsSectionProps) {
  const [activePanelId, setActivePanelId] = useState<IntegrationPanelId>('mcp')
  const [inspection, setInspection] = useState<IntegrationInspectResponse | null>(null)
  const [inspectionLoading, setInspectionLoading] = useState(false)
  const [inspectionError, setInspectionError] = useState('')
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1], params?: Record<string, string>) => (
    pickTranslatedUiText(uiLanguage, key, params)
  )

  useEffect(() => {
    if (!active || !window.desktopPet?.inspectIntegrations) {
      return
    }

    let cancelled = false
    const timerId = window.setTimeout(() => {
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
      })
        .then((result) => {
          if (!cancelled) {
            setInspection(result)
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setInspectionError(error instanceof Error ? error.message : String(error))
          }
        })
        .finally(() => {
          if (!cancelled) {
            setInspectionLoading(false)
          }
        })
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timerId)
    }
  }, [
    active,
    draft.factorioIntegrationEnabled,
    draft.factorioServerAddress,
    draft.factorioServerPort,
    draft.factorioUsername,
    draft.mcpServers,
    draft.minecraftIntegrationEnabled,
    draft.minecraftServerAddress,
    draft.minecraftServerPort,
    draft.minecraftUsername,
  ])

  function getModuleRuntime(id: InspectableIntegrationModuleId) {
    return inspection?.modules.find((module) => module.id === id) ?? null
  }

  function getStatusLabel(status: IntegrationRuntimeModuleState['status']) {
    switch (status) {
      case 'ready':
        return ti('settings.integrations.status.ready')
      case 'configured':
        return ti('settings.integrations.status.configured')
      case 'disabled':
        return ti('settings.integrations.status.disabled')
      case 'error':
        return ti('settings.integrations.status.needs_repair')
      default:
        return ti('settings.integrations.status.setup')
    }
  }

  function getStatusHint(runtime: IntegrationRuntimeModuleState | null) {
    if (!runtime) {
      return inspectionLoading
        ? ti('settings.integrations.hint.refreshing_probe')
        : ti('settings.integrations.hint.waiting_probe')
    }

    if (runtime.id === 'mcp') {
      if (runtime.status === 'configured') {
        return ti('settings.integrations.hint.mcp_configured')
      }

      if (runtime.status === 'error') {
        return ti('settings.integrations.hint.mcp_error')
      }

      return ti('settings.integrations.hint.mcp_default')
    }

    if (runtime.status === 'ready') {
      return ti('settings.integrations.hint.ready')
    }

    if (runtime.status === 'error') {
      return ti('settings.integrations.hint.error')
    }

    if (runtime.status === 'configured') {
      return ti('settings.integrations.hint.configured')
    }

    return ti('settings.integrations.hint.default')
  }

  function renderRuntimeBlock(moduleId: InspectableIntegrationModuleId) {
    const runtime = getModuleRuntime(moduleId)

    return (
      <div className="settings-drawer__card">
        <div className="settings-section__title-row">
          <div>
            <h5>{ti('settings.integrations.runtime_probe')}</h5>
            <p className="settings-drawer__hint">{getStatusHint(runtime)}</p>
          </div>
          <div className="settings-page__meta">
            <span>{runtime ? getStatusLabel(runtime.status) : ti('settings.integrations.pending')}</span>
            <span>{inspection?.generatedAt ? inspection.generatedAt.replace('T', ' ').slice(0, 19) : ti('settings.integrations.no_timestamp')}</span>
          </div>
        </div>

        {runtime?.id === 'mcp' ? (
          <div className="settings-stack">
            <p className="settings-inline-note">
              {runtime.command
                ? `${ti('settings.integrations.command')}: ${runtime.command}`
                : ti('settings.integrations.command_missing')}
            </p>
            <p className="settings-inline-note">
              {runtime.commandFound
                ? `${ti('settings.integrations.resolution')}: ${runtime.commandResolvedPath || ti('settings.integrations.resolved')}`
                : `${ti('settings.integrations.resolution')}: ${runtime.commandResolvedPath || ti('settings.integrations.not_found')}`}
            </p>
            <p className="settings-inline-note">
              {runtime.args?.length
                ? `${ti('settings.integrations.launch_args')}: ${runtime.args.join(' ')}`
                : ti('settings.integrations.no_launch_args')}
            </p>
          </div>
        ) : runtime?.endpoint ? (
          <div className="settings-stack">
            <p className="settings-inline-note">
              {`${ti('settings.integrations.endpoint_probe')}: ${runtime.endpoint.host}:${runtime.endpoint.port} / ${runtime.endpoint.ok ? ti('settings.integrations.reachable') : ti('settings.integrations.unreachable')}`}
            </p>
            <p className="settings-inline-note">
              {`${ti('settings.integrations.network_result')}: ${runtime.endpoint.message}${runtime.endpoint.latencyMs != null ? ` (${runtime.endpoint.latencyMs}ms)` : ''}`}
            </p>
            <p className="settings-inline-note">
              {runtime.username
                ? `${ti('settings.integrations.identity')}: ${runtime.username}`
                : ti('settings.integrations.identity_missing')}
            </p>
          </div>
        ) : (
          <p className="settings-inline-note">
            {runtime?.note ?? ti('settings.integrations.runtime_waiting')}
          </p>
        )}

        {runtime?.note ? (
          <p className="settings-inline-note">{runtime.note}</p>
        ) : null}
      </div>
    )
  }

  function renderModuleSelectorCard(
    descriptor: IntegrationModuleDescriptor,
  ) {
    const selected = activePanelId === descriptor.panelId
    const runtime = descriptor.panelId ? getModuleRuntime(descriptor.panelId) : null
    const badge = runtime ? getStatusLabel(runtime.status) : getIntegrationText(uiLanguage, descriptor.badge)

    return (
      <button
        key={descriptor.id}
        type="button"
        className={`settings-choice-card ${selected ? 'is-active' : ''}`}
        aria-pressed={selected}
        onClick={() => descriptor.panelId && setActivePanelId(descriptor.panelId)}
      >
        <span className="settings-choice-card__header">
          <strong>{getIntegrationText(uiLanguage, descriptor.title)}</strong>
          <span className="settings-choice-card__badge">{badge}</span>
        </span>
        <span className="settings-choice-card__description">
          {getIntegrationText(uiLanguage, descriptor.summary)}
        </span>
      </button>
    )
  }

  function renderRoadmapCard(descriptor: IntegrationModuleDescriptor) {
    return (
      <article key={descriptor.id} className="settings-drawer__card">
        <div className="settings-section__title-row">
          <div>
            <h5>{getIntegrationText(uiLanguage, descriptor.title)}</h5>
            <p className="settings-drawer__hint">{getIntegrationText(uiLanguage, descriptor.summary)}</p>
          </div>
          <div className="settings-page__meta">
            <span>{getIntegrationText(uiLanguage, descriptor.badge)}</span>
          </div>
        </div>

        <p className="settings-inline-note">
          {getIntegrationText(uiLanguage, descriptor.designPattern)}
        </p>
        <p className="settings-inline-note">
          {getIntegrationText(uiLanguage, descriptor.nextStep)}
        </p>
        <p className="settings-inline-note">
          {`${ti('settings.integrations.design_refs')}: ${descriptor.references.join(' / ')}`}
        </p>
      </article>
    )
  }

  function updateMcpServer(serverId: string, patch: Partial<McpServerConfig>) {
    setDraft((prev) => ({
      ...prev,
      mcpServers: prev.mcpServers.map((server) =>
        server.id === serverId ? { ...server, ...patch } : server,
      ),
    }))
  }

  function addMcpServer() {
    const newServer: McpServerConfig = {
      id: `mcp-${crypto.randomUUID().slice(0, 8)}`,
      label: '',
      command: '',
      args: '',
      enabled: true,
    }
    setDraft((prev) => ({
      ...prev,
      mcpServers: [...prev.mcpServers, newServer],
    }))
  }

  function removeMcpServer(serverId: string) {
    setDraft((prev) => ({
      ...prev,
      mcpServers: prev.mcpServers.filter((server) => server.id !== serverId),
    }))
  }

  function renderMcpServerCard(server: McpServerConfig) {
    return (
      <div key={server.id} className="settings-drawer__card">
        <div className="settings-section__title-row">
          <div>
            <h5>{server.label || server.command || ti('settings.integrations.mcp.unnamed_server')}</h5>
          </div>
          <div className="settings-page__meta">
            <span>{server.enabled ? ti('settings.integrations.module_enabled') : ti('settings.integrations.module_disabled')}</span>
          </div>
        </div>

        <label className="settings-toggle">
          <span>{ti('settings.integrations.mcp.server_enabled')}</span>
          <input
            type="checkbox"
            checked={server.enabled}
            onChange={(event) => updateMcpServer(server.id, { enabled: event.target.checked })}
          />
        </label>

        <label>
          <span>{ti('settings.integrations.mcp.server_label')}</span>
          <input
            value={server.label}
            placeholder="My MCP Server"
            onChange={(event) => updateMcpServer(server.id, { label: event.target.value })}
          />
        </label>

        <label>
          <span>{ti('settings.integrations.launch_command')}</span>
          <input
            value={server.command}
            placeholder="npx @modelcontextprotocol/server-filesystem"
            onChange={(event) => updateMcpServer(server.id, { command: event.target.value })}
          />
        </label>

        <label>
          <span>{ti('settings.integrations.launch_args_label')}</span>
          <textarea
            rows={3}
            value={server.args}
            placeholder="--transport stdio --root F:\\data"
            onChange={(event) => updateMcpServer(server.id, { args: event.target.value })}
          />
        </label>

        <button
          type="button"
          className="settings-danger-button"
          onClick={() => removeMcpServer(server.id)}
        >
          {ti('settings.integrations.mcp.remove_server')}
        </button>
      </div>
    )
  }

  function renderMcpPanel() {
    return (
      <>
        <div className="settings-drawer__card">
          <div className="settings-section__title-row">
            <div>
              <h5>{ti('settings.integrations.mcp.title')}</h5>
              <p className="settings-drawer__hint">{ti('settings.integrations.mcp.note')}</p>
            </div>
            <div className="settings-page__meta">
              <span>{`${draft.mcpServers.length} server(s)`}</span>
              <span>{ti('settings.integrations.structure_aligned')}</span>
            </div>
          </div>

          <button
            type="button"
            className="settings-action-button"
            onClick={addMcpServer}
          >
            {ti('settings.integrations.mcp.add_server')}
          </button>

          <p className="settings-inline-note">{ti('settings.integrations.mcp.next_step')}</p>
        </div>

        {draft.mcpServers.map((server) => renderMcpServerCard(server))}

        {renderRuntimeBlock('mcp')}
      </>
    )
  }

  function renderGamePanel(kind: 'minecraft' | 'factorio') {
    const isMinecraft = kind === 'minecraft'
    const enabled = isMinecraft ? draft.minecraftIntegrationEnabled : draft.factorioIntegrationEnabled
    const serverAddress = isMinecraft ? draft.minecraftServerAddress : draft.factorioServerAddress
    const serverPort = isMinecraft ? draft.minecraftServerPort : draft.factorioServerPort
    const username = isMinecraft ? draft.minecraftUsername : draft.factorioUsername
    const title = isMinecraft ? 'Minecraft' : 'Factorio'
    const defaultPort = isMinecraft ? 25565 : 34197

    return (
      <>
        <div className="settings-drawer__card">
          <div className="settings-section__title-row">
            <div>
              <h5>{title}</h5>
              <p className="settings-drawer__hint">
                {isMinecraft
                  ? ti('settings.integrations.game.minecraft_note')
                  : ti('settings.integrations.game.factorio_note')}
              </p>
            </div>
            <div className="settings-page__meta">
              <span>{enabled ? ti('settings.integrations.module_enabled') : ti('settings.integrations.module_disabled')}</span>
              <span>{ti('settings.integrations.module_factory')}</span>
            </div>
          </div>

          <label className="settings-toggle">
            <span>{ti('settings.integrations.enable_game', { name: title })}</span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => {
                const nextValue = event.target.checked
                setDraft((prev) => (
                  isMinecraft
                    ? { ...prev, minecraftIntegrationEnabled: nextValue }
                    : { ...prev, factorioIntegrationEnabled: nextValue }
                ))
              }}
            />
          </label>

          <div className="settings-grid settings-grid--two">
            <label>
              <span>{ti('settings.integrations.server_address')}</span>
              <input
                value={serverAddress}
                placeholder={ti('settings.integrations.address_example')}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setDraft((prev) => (
                    isMinecraft
                      ? { ...prev, minecraftServerAddress: nextValue }
                      : { ...prev, factorioServerAddress: nextValue }
                  ))
                }}
              />
            </label>

            <label>
              <span>{ti('settings.integrations.port')}</span>
              <input
                type="number"
                min={1}
                max={65535}
                step={1}
                value={String(serverPort)}
                onChange={(event) => {
                  const nextPort = Math.min(
                    65535,
                    Math.max(1, parseNumberInput(event.target.value, serverPort || defaultPort)),
                  )

                  setDraft((prev) => (
                    isMinecraft
                      ? { ...prev, minecraftServerPort: nextPort }
                      : { ...prev, factorioServerPort: nextPort }
                  ))
                }}
              />
            </label>

            <label className="settings-grid__span-two">
              <span>{ti('settings.integrations.identity')}</span>
              <input
                value={username}
                placeholder={ti('settings.integrations.identity_example')}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setDraft((prev) => (
                    isMinecraft
                      ? { ...prev, minecraftUsername: nextValue }
                      : { ...prev, factorioUsername: nextValue }
                  ))
                }}
              />
            </label>
          </div>

          <p className="settings-inline-note">
            {isMinecraft
              ? ti('settings.integrations.game.minecraft_next')
              : ti('settings.integrations.game.factorio_next')}
          </p>
        </div>

        {renderRuntimeBlock(kind)}
      </>
    )
  }

  return (
    <section className={`settings-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-section__title-row">
        <div>
          <h4>{ti('settings.integrations.title')}</h4>
          <p className="settings-drawer__hint">{ti('settings.integrations.note')}</p>
        </div>
        <p className="settings-section__note">
          {inspectionLoading
            ? ti('settings.integrations.refreshing_state')
            : ti('settings.integrations.runtime_wired')}
        </p>
      </div>

      <div className="settings-drawer__card">
        <div className="settings-section__title-row">
          <div>
            <h5>{ti('settings.integrations.skeleton_title')}</h5>
            <p className="settings-drawer__hint">{ti('settings.integrations.skeleton_note')}</p>
          </div>
        </div>

        <div
          className="settings-choice-grid settings-choice-grid--compact"
          role="tablist"
          aria-label={ti('settings.integrations.wired_modules_label')}
        >
          {inspectableModules.map((descriptor) => renderModuleSelectorCard(descriptor))}
        </div>

        {inspectionError ? (
          <div className="settings-test-result is-error">{inspectionError}</div>
        ) : null}

        <p className="settings-inline-note">{ti('settings.integrations.probe_note')}</p>
      </div>

      {activePanelId === 'mcp' ? renderMcpPanel() : null}
      {activePanelId === 'minecraft' ? renderGamePanel('minecraft') : null}
      {activePanelId === 'factorio' ? renderGamePanel('factorio') : null}

      <div className="settings-section__title-row">
        <div>
          <h4>{ti('settings.integrations.next_modules')}</h4>
          <p className="settings-drawer__hint">{ti('settings.integrations.next_modules_note')}</p>
        </div>
      </div>

      {roadmapModules.map((descriptor) => renderRoadmapCard(descriptor))}
    </section>
  )
})
