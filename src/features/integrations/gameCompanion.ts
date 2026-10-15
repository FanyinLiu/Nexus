/**
 * Minecraft and Factorio remain for a later voice-chat companion
 * (Mineflayer). 0.5.0 must not offer them: Minecraft opens a WebSocket
 * rather than the Java protocol, and Factorio still sends an empty
 * password. Saved settings stay in the schema and are not rewritten.
 *
 * Set `VITE_NEXUS_ENABLE_GAME_COMPANION=1` to show the rows and allow
 * startup connect again. Any other value, including unset, keeps both off.
 */

import type { InspectableIntegrationModuleId } from '../../types/integrations.ts'

type EnvLike = Record<string, string | boolean | undefined>

const GAME_COMPANION_FLAG = 'VITE_NEXUS_ENABLE_GAME_COMPANION'

export type GameCompanionSettings = {
  minecraftIntegrationEnabled: boolean
  minecraftServerAddress: string
  minecraftServerPort: number
  minecraftUsername: string
  factorioIntegrationEnabled: boolean
  factorioServerAddress: string
  factorioServerPort: number
}

export type GameConnectionFlags = {
  minecraft: boolean
  factorio: boolean
}

export type GameCompanionClient = {
  minecraftConnect?: (payload: { address: string; port: number; username: string }) => Promise<unknown>
  minecraftDisconnect?: () => Promise<unknown>
  factorioConnect?: (payload: { address: string; port: number; password: string }) => Promise<unknown>
  factorioDisconnect?: () => Promise<unknown>
}

export type IntegrationStatusRow = {
  id: InspectableIntegrationModuleId
  label: string
}

type SyncGameConnectionsOptions = {
  settings: GameCompanionSettings
  connected: GameConnectionFlags
  client: GameCompanionClient | null | undefined
  env?: EnvLike
  onMinecraftError?: (error: unknown) => void
  onFactorioError?: (error: unknown) => void
}

function readEnv(env?: EnvLike): EnvLike | undefined {
  if (env) return env
  return (import.meta as ImportMeta & { env?: EnvLike }).env
}

/** True only when the build explicitly opts into the unfinished game companion. */
export function isGameCompanionEnabled(env?: EnvLike): boolean {
  return readEnv(env)?.[GAME_COMPANION_FLAG] === '1'
}

/**
 * Status rows for Settings → Integrations. Minecraft and Factorio are
 * omitted unless the companion flag is on, so a saved configuration
 * cannot surface a probe error.
 */
export function integrationStatusRows(env?: EnvLike): IntegrationStatusRow[] {
  const rows: IntegrationStatusRow[] = [{ id: 'mcp', label: 'MCP' }]
  if (isGameCompanionEnabled(env)) {
    rows.push(
      { id: 'minecraft', label: 'Minecraft' },
      { id: 'factorio', label: 'Factorio' },
    )
  }
  rows.push(
    { id: 'telegram', label: 'Telegram' },
    { id: 'discord', label: 'Discord' },
  )
  return rows
}

/** Whether the integrations page should render the game disclosures. */
export function areGameCompanionRowsVisible(env?: EnvLike): boolean {
  return integrationStatusRows(env).some((row) => row.id === 'minecraft' || row.id === 'factorio')
}

function attachFailure(pending: Promise<unknown> | undefined, onError?: (error: unknown) => void): void {
  void pending?.catch((error: unknown) => {
    onError?.(error)
  })
}

/**
 * Apply the startup connect/disconnect decision.
 * With the flag off this never calls connect, even when saved settings
 * still say the games are enabled.
 */
export function syncGameConnections({
  settings,
  connected,
  client,
  env,
  onMinecraftError,
  onFactorioError,
}: SyncGameConnectionsOptions): GameConnectionFlags {
  const enabled = isGameCompanionEnabled(env)
  const next: GameConnectionFlags = {
    minecraft: connected.minecraft,
    factorio: connected.factorio,
  }

  const minecraftTarget = enabled
    && settings.minecraftIntegrationEnabled
    && settings.minecraftServerAddress
    && settings.minecraftServerPort
    && settings.minecraftUsername
    ? {
        address: settings.minecraftServerAddress,
        port: settings.minecraftServerPort,
        username: settings.minecraftUsername,
      }
    : null

  if (minecraftTarget && !next.minecraft && client?.minecraftConnect) {
    next.minecraft = true
    attachFailure(client.minecraftConnect(minecraftTarget), onMinecraftError)
  } else if (!minecraftTarget && next.minecraft) {
    next.minecraft = false
    void client?.minecraftDisconnect?.().catch(() => {})
  }

  const factorioTarget = enabled
    && settings.factorioIntegrationEnabled
    && settings.factorioServerAddress
    && settings.factorioServerPort
    ? {
        address: settings.factorioServerAddress,
        port: settings.factorioServerPort,
        // The stored field is an identity, not an RCON password. Kept so
        // the later companion can replace this call without a new IPC shape.
        password: '',
      }
    : null

  if (factorioTarget && !next.factorio && client?.factorioConnect) {
    next.factorio = true
    attachFailure(client.factorioConnect(factorioTarget), onFactorioError)
  } else if (!factorioTarget && next.factorio) {
    next.factorio = false
    void client?.factorioDisconnect?.().catch(() => {})
  }

  return next
}
