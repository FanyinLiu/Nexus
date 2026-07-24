/**
 * MCP tool descriptor contract.
 * Kept separate from toolCallLoop so built-in tool schema builders can import
 * the type without forming a cycle:
 * toolCallLoop → builtInToolExecutor → builtInToolSchemas → toolCallLoop.
 */

export type McpToolDescriptor = {
  name: string
  description: string
  serverId: string
  inputSchema?: Record<string, unknown>
  skillGuide?: string
  /**
   * When true, this descriptor is always included in the payload regardless
   * of keyword relevance. Used by built-in tools (web_search / weather /
   * open_external) so the LLM can invoke them even when the user's phrasing
   * doesn't lexically overlap with the tool name or description.
   */
  alwaysInclude?: boolean
}
