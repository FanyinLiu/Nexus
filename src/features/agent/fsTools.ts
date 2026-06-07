// Native fs tools for the agent loop — Read / Edit / Write / Glob / Grep.
//
// These bypass the MCP plugin layer and call the sandboxed Electron service
// directly. The workspace root is configured via settings.agentWorkspaceRoot
// and enforced in main process (electron/services/workspaceFs.js) — paths
// outside the root are rejected before any disk access.
//
// The tools are exposed as McpToolDescriptor entries so the existing
// runToolCallLoop can execute them via native function calling. The actual
// dispatch happens inside executeFsTool, which is invoked by the agent
// runner before delegating to mcpCallTool.

import type { McpToolDescriptor } from '../chat/toolCallLoop'

export const FS_TOOL_NAMES = [
  'fs_read',
  'fs_write',
  'fs_edit',
  'fs_glob',
  'fs_grep',
] as const

export type FsToolName = (typeof FS_TOOL_NAMES)[number]

export function isFsToolName(name: string): name is FsToolName {
  return (FS_TOOL_NAMES as readonly string[]).includes(name)
}

const FS_TOOL_DESCRIPTORS: McpToolDescriptor[] = [
  {
    name: 'fs_read',
    description: 'Read a text file from the workspace. Caps at 256KB; truncated content is marked.',
    serverId: 'builtin:fs',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'fs_write',
    description: 'Create or overwrite a text file in the workspace. Use sparingly — prefer fs_edit for in-place changes.',
    serverId: 'builtin:fs',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'fs_edit',
    description: 'Replace a unique substring inside a workspace file. Fails if oldString is missing or appears more than once.',
    serverId: 'builtin:fs',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        oldString: { type: 'string' },
        newString: { type: 'string' },
      },
      required: ['path', 'oldString', 'newString'],
    },
  },
  {
    name: 'fs_glob',
    description: 'Find workspace files matching a glob pattern (supports * ** ?). Returns up to 200 paths.',
    serverId: 'builtin:fs',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'fs_grep',
    description: 'Regex-search workspace file contents. Returns up to 50 matching lines by default.',
    serverId: 'builtin:fs',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'JavaScript regex source' },
        caseSensitive: { type: 'boolean', default: false },
        maxResults: { type: 'number', default: 50 },
      },
      required: ['query'],
    },
  },
]

export function getFsToolDescriptors(): McpToolDescriptor[] {
  return FS_TOOL_DESCRIPTORS
}

export async function setWorkspaceRoot(root: string): Promise<string> {
  const bridge = window.desktopPet
  if (!bridge?.workspaceSetRoot) {
    throw new Error('Workspace fs bridge not available')
  }
  const result = await bridge.workspaceSetRoot({ root })
  return result.root
}

export async function getWorkspaceRoot(): Promise<string> {
  const bridge = window.desktopPet
  if (!bridge?.workspaceGetRoot) return ''
  const result = await bridge.workspaceGetRoot()
  return result.root
}

const FS_PATH_TRAVERSAL_RE = /(?:^|[\\/])\.\.(?:[\\/]|$)/
const FS_GREP_QUERY_MAX_LENGTH = 500

function validateFsPath(p: string): void {
  if (!p.trim()) {
    throw new Error('Path must be a non-empty workspace-relative path')
  }
  if (FS_PATH_TRAVERSAL_RE.test(p)) {
    throw new Error(`Path "${p}" contains disallowed ".." traversal segments`)
  }
}

/**
 * Execute a built-in fs tool by name. Returns a JSON-serializable result
 * suitable for feeding back into the model as a tool result. Throws if the
 * tool name isn't recognized or the workspace bridge is missing.
 */
export async function executeFsTool(
  name: FsToolName,
  args: Record<string, unknown>,
): Promise<unknown> {
  const bridge = window.desktopPet
  if (!bridge) {
    throw new Error('Desktop bridge not available')
  }

  switch (name) {
    case 'fs_read': {
      if (!bridge.workspaceRead) throw new Error('workspaceRead bridge missing')
      const p = String(args.path ?? '')
      validateFsPath(p)
      return bridge.workspaceRead({ path: p })
    }
    case 'fs_write': {
      if (!bridge.workspaceWrite) throw new Error('workspaceWrite bridge missing')
      const p = String(args.path ?? '')
      validateFsPath(p)
      return bridge.workspaceWrite({
        path: p,
        content: String(args.content ?? ''),
      })
    }
    case 'fs_edit': {
      if (!bridge.workspaceEdit) throw new Error('workspaceEdit bridge missing')
      const p = String(args.path ?? '')
      validateFsPath(p)
      return bridge.workspaceEdit({
        path: p,
        oldString: String(args.oldString ?? ''),
        newString: String(args.newString ?? ''),
      })
    }
    case 'fs_glob':
      if (!bridge.workspaceGlob) throw new Error('workspaceGlob bridge missing')
      return bridge.workspaceGlob({ pattern: String(args.pattern ?? '') })
    case 'fs_grep': {
      if (!bridge.workspaceGrep) throw new Error('workspaceGrep bridge missing')
      const query = String(args.query ?? '')
      if (query.length > FS_GREP_QUERY_MAX_LENGTH) {
        throw new Error(`Grep query exceeds maximum length of ${FS_GREP_QUERY_MAX_LENGTH} characters`)
      }
      return bridge.workspaceGrep({
        query,
        caseSensitive: Boolean(args.caseSensitive),
        maxResults: typeof args.maxResults === 'number' ? args.maxResults : undefined,
      })
    }
    default: {
      const exhaustive: never = name
      throw new Error(`Unknown fs tool: ${exhaustive}`)
    }
  }
}
