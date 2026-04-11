export type InspectableIntegrationModuleId = 'mcp' | 'minecraft' | 'factorio' | 'telegram' | 'discord'

export type IntegrationRuntimeStatus =
  | 'disabled'
  | 'unconfigured'
  | 'configured'
  | 'ready'
  | 'error'

export interface IntegrationInspectRequest {
  mcpServers: import('./app').McpServerConfig[]
  minecraftIntegrationEnabled: boolean
  minecraftServerAddress: string
  minecraftServerPort: number
  minecraftUsername: string
  factorioIntegrationEnabled: boolean
  factorioServerAddress: string
  factorioServerPort: number
  factorioUsername: string
}

export interface IntegrationEndpointProbe {
  host: string
  port: number
  ok: boolean
  latencyMs: number | null
  message: string
}

export interface IntegrationRuntimeModuleState {
  id: InspectableIntegrationModuleId
  status: IntegrationRuntimeStatus
  enabled: boolean
  configured: boolean
  connected: boolean
  note?: string
  command?: string
  args?: string[]
  commandFound?: boolean
  commandResolvedPath?: string
  endpoint?: IntegrationEndpointProbe
  username?: string
}

export interface IntegrationInspectResponse {
  generatedAt: string
  modules: IntegrationRuntimeModuleState[]
}
