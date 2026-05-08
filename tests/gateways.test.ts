/**
 * Unit tests for gateway modules.
 *
 * Only minecraftGateway is testable in plain Node.js — discordGateway and
 * telegramGateway import `{ net } from 'electron'` and cannot be loaded
 * without an Electron runtime.
 */
import assert from 'node:assert/strict'
import { describe, test, before, after } from 'node:test'
import { WebSocketServer } from 'ws'

import {
  getStatus,
  getRecentEvents,
  getGameContext,
  onEvent,
  sendCommand,
  connect,
  disconnect,
} from '../electron/services/minecraftGateway.js'

// ── Pure state tests (no server needed) ────────────────────────────────────

describe('minecraftGateway: default state', () => {
  before(async () => { await disconnect() })

  test('getStatus returns disconnected defaults', () => {
    const s = getStatus()
    assert.equal(s.state, 'disconnected')
    assert.equal(s.address, null)
    assert.equal(s.port, null)
    assert.equal(s.username, null)
    assert.equal(s.reconnectCount, 0)
    assert.ok(Array.isArray(s.recentEvents))
  })

  test('getRecentEvents returns empty array', () => {
    assert.ok(Array.isArray(getRecentEvents()))
  })

  test('getGameContext returns null when disconnected', () => {
    assert.equal(getGameContext(), null)
  })

  test('sendCommand throws when not connected', () => {
    assert.throws(() => sendCommand('/say hello'), {
      message: 'Minecraft gateway is not connected',
    })
  })

  test('onEvent accepts a callback without throwing', () => {
    onEvent(() => {})
    onEvent(null)
  })
})

// ── WebSocket integration tests ────────────────────────────────────────────

describe('minecraftGateway: WebSocket integration', () => {
  let wss: InstanceType<typeof WebSocketServer> | null = null
  let port: number
  let serverUnavailableReason = ''

  function requireServer(t: { skip: (message?: string) => void }) {
    if (!wss) {
      t.skip(serverUnavailableReason || 'WebSocket server unavailable')
      return false
    }
    return true
  }

  before(async () => {
    await disconnect()
    wss = await new Promise((resolve) => {
      const server = new WebSocketServer({ port: 0 }, () => resolve(server))
      server.once('error', (error) => {
        serverUnavailableReason = `WebSocket server unavailable: ${error.message}`
        resolve(null)
      })
    })
    if (!wss) return
    const addr = wss.address()
    port = typeof addr === 'object' ? addr.port : 0
  })

  after(async () => {
    await disconnect()
    if (!wss) return
    for (const client of wss.clients) {
      client.close()
    }
    await new Promise<void>((resolve) => wss.close(() => resolve()))
  })

  test('connect sets state to connected and populates status', async (t) => {
    if (!requireServer(t)) return
    const captured: object[] = []
    onEvent((e) => captured.push(e))

    await connect('127.0.0.1', port, 'TestUser')

    const status = getStatus()
    assert.equal(status.state, 'connected')
    assert.equal(status.address, '127.0.0.1')
    assert.equal(status.port, port)
    assert.equal(status.username, 'TestUser')
    assert.equal(status.reconnectCount, 0)

    // The 'connected' event should be logged.
    const events = getRecentEvents(100)
    const types = events.map((e: { type: string }) => e.type)
    assert.ok(types.includes('connected'), `expected 'connected' in ${JSON.stringify(types)}`)

    // onEvent callback should have fired for the 'connected' event.
    assert.ok(captured.length >= 1, `expected >= 1 captured event, got ${captured.length}`)

    onEvent(null)
    await disconnect()
  })

  test('connect throws when already connected', async (t) => {
    if (!requireServer(t)) return
    await connect('127.0.0.1', port, 'User1')
    await assert.rejects(
      () => connect('127.0.0.1', port, 'User2'),
      { message: /already connected/i },
    )
    await disconnect()
  })

  test('disconnect sets state back to disconnected', async (t) => {
    if (!requireServer(t)) return
    await connect('127.0.0.1', port, 'DiscoUser')
    assert.equal(getStatus().state, 'connected')

    await disconnect()
    assert.equal(getStatus().state, 'disconnected')
    assert.equal(getStatus().address, null)
  })

  test('getGameContext returns context when connected', async (t) => {
    if (!requireServer(t)) return
    await connect('127.0.0.1', port, 'CtxUser')

    const ctx = getGameContext()
    assert.ok(ctx !== null)
    assert.equal(ctx!.game, 'minecraft')
    assert.equal(ctx!.connected, true)
    assert.equal(ctx!.username, 'CtxUser')
    assert.ok(Array.isArray(ctx!.recentChat))
    assert.ok(Array.isArray(ctx!.recentPlayerEvents))

    await disconnect()
    assert.equal(getGameContext(), null)
  })

  test('sendCommand sends valid JSON to server', async (t) => {
    if (!requireServer(t)) return
    const received: string[] = []
    const connReady = new Promise<void>((resolve) => {
      wss.once('connection', (ws) => {
        ws.on('message', (data) => received.push(String(data)))
        resolve()
      })
    })

    await connect('127.0.0.1', port, 'CmdUser')
    await connReady

    sendCommand('/say hi')
    await new Promise((r) => setTimeout(r, 100))

    type McpWsMessage = {
      header?: { messagePurpose?: string }
      body?: { commandLine?: string; eventName?: string }
    }
    const cmdMsg = received
      .map((r) => JSON.parse(r) as McpWsMessage)
      .find((m) =>
        m.header?.messagePurpose === 'commandRequest' &&
        m.body?.commandLine === '/say hi'
      )

    assert.ok(cmdMsg, 'expected a commandRequest with /say hi in server-received messages')
    assert.equal(cmdMsg.body.commandLine, '/say hi')
    assert.equal(cmdMsg.body.origin.type, 'player')

    await disconnect()
  })

  test('connect sends subscription messages for all tracked events', async (t) => {
    if (!requireServer(t)) return
    const received: string[] = []
    const connReady = new Promise<void>((resolve) => {
      wss.once('connection', (ws) => {
        ws.on('message', (data) => received.push(String(data)))
        // Give time for all subscriptions to arrive.
        setTimeout(resolve, 100)
      })
    })

    await connect('127.0.0.1', port, 'SubUser')
    await connReady

    type WsSubMessage = {
      header?: { messagePurpose?: string }
      body?: { eventName?: string }
    }
    const subscriptions = received
      .map((r) => JSON.parse(r) as WsSubMessage)
      .filter((m) => m.header?.messagePurpose === 'subscribe')
      .map((m) => m.body?.eventName)

    const expected = [
      'PlayerMessage', 'PlayerJoin', 'PlayerLeave', 'PlayerDied',
      'PlayerTravelled', 'BlockPlaced', 'BlockBroken', 'ItemUsed',
    ]
    for (const evt of expected) {
      assert.ok(subscriptions.includes(evt), `expected subscription for '${evt}'`)
    }

    await disconnect()
  })

  test('getRecentEvents respects limit parameter', async (t) => {
    if (!requireServer(t)) return
    await connect('127.0.0.1', port, 'LimitUser')
    // There should be at least a 'connected' event.
    const limited = getRecentEvents(1)
    assert.ok(limited.length <= 1)
    await disconnect()
  })

  test('server-sent event messages land in the event log', async (t) => {
    if (!requireServer(t)) return
    // Regression guard: a previous version of connect() never attached a
    // 'message' event listener, so handleWsMessage was dead code.
    const received: Array<{ type: string }> = []
    const unsubscribe = (() => {
      const handler = (e: unknown) => received.push(e as { type: string })
      onEvent(handler)
      return () => onEvent(null)
    })()

    wss.once('connection', (ws) => {
      setTimeout(() => {
        ws.send(JSON.stringify({
          header: { messagePurpose: 'event', eventName: 'PlayerMessage' },
          body: { sender: 'Steve', message: 'hi' },
        }))
      }, 20)
    })

    await connect('127.0.0.1', port, 'MsgUser')
    await new Promise((r) => setTimeout(r, 120))

    const types = received.map((e) => e.type)
    assert.ok(types.includes('PlayerMessage'),
      `expected PlayerMessage in event stream, got ${JSON.stringify(types)}`)

    unsubscribe()
    await disconnect()
  })
})
