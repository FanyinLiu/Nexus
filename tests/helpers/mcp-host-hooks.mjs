// node:module resolve/load hooks that let node:test import the MCP host
// with a stubbed electron and a stubbed child_process.spawn.
//
// The spawn stub records every spawn call and answers the JSON-RPC
// handshake, so a test can assert the environment a real MCP child would
// receive without running a server.
//
// Registered via `register(new URL('./helpers/mcp-host-hooks.mjs', ...))`
// before the dynamic import of the module under test.

const ELECTRON_STUB = `
export const app = {
  getPath(name) {
    const root = globalThis.__nexusMcpTestUserData
    if (typeof root !== 'string' || !root) {
      throw new Error('mcp test userData is not set')
    }
    return root
  },
}
export const dialog = {
  async showMessageBox() { return { response: 1 } },
}
export const BrowserWindow = {
  getFocusedWindow: () => null,
  getAllWindows: () => [],
}
`

const CHILD_PROCESS_STUB = `
import { EventEmitter } from 'node:events'

class FakeStream extends EventEmitter {
  setEncoding() {}
}

class FakeChild extends EventEmitter {
  constructor() {
    super()
    this.pid = 4242
    this.stdout = new FakeStream()
    this.stderr = new FakeStream()
    this.stdin = {
      writable: true,
      write: (raw) => {
        let message
        try { message = JSON.parse(String(raw)) } catch { return true }
        if (!message || message.id === undefined) return true
        const result = message.method === 'initialize'
          ? { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'stub', version: '0.0.0' } }
          : { tools: [] }
        setTimeout(() => {
          this.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')
        }, 0)
        return true
      },
    }
    setTimeout(() => this.emit('spawn'), 0)
  }

  kill() {
    this.emit('exit', 0, null)
    return true
  }
}

export function spawn(command, args, options) {
  const record = globalThis.__nexusMcpTestSpawn
  if (Array.isArray(record)) record.push({ command, args, options })
  return new FakeChild()
}

export default { spawn }
`

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: 'mcp-stub:electron', shortCircuit: true }
  }
  if (specifier === 'node:child_process') {
    return { url: 'mcp-stub:child-process', shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url === 'mcp-stub:electron') {
    return { format: 'module', shortCircuit: true, source: ELECTRON_STUB }
  }
  if (url === 'mcp-stub:child-process') {
    return { format: 'module', shortCircuit: true, source: CHILD_PROCESS_STUB }
  }
  return nextLoad(url, context)
}
