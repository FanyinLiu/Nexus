import { useEffect, useRef } from 'react'
import type { McpServerConfig } from '../types'

/**
 * Keeps the main-process MCP host in sync with the user's configured
 * server list. Runs once on mount (after settings load) and again any
 * time the user edits the server list in Settings → Integrations.
 *
 * Stringifying the config list keeps the dep stable across React
 * re-renders when the array reference changes but the content doesn't
 * — otherwise every settings save would force a reconcile pass.
 */
export function useMcpServerSync(mcpServers: McpServerConfig[] | undefined) {
  const lastSignatureRef = useRef<string>('')

  useEffect(() => {
    const bridge = window.desktopPet
    if (!bridge?.mcpSyncServers) return

    const list = Array.isArray(mcpServers) ? mcpServers : []
    const signature = JSON.stringify(
      list.map((server) => ({
        id: server.id,
        command: server.command,
        args: server.args,
        enabled: server.enabled,
      })),
    )
    if (signature === lastSignatureRef.current) return
    if (list.length === 0 && lastSignatureRef.current === '') {
      lastSignatureRef.current = signature
      return
    }
    lastSignatureRef.current = signature

    void bridge.mcpSyncServers({ servers: list }).catch((error: unknown) => {
      console.warn('[MCP] sync failed:', error instanceof Error ? error.message : error)
    })
  }, [mcpServers])
}
