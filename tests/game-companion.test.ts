import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  areGameCompanionRowsVisible,
  integrationStatusRows,
  isGameCompanionEnabled,
  syncGameConnections,
  type GameCompanionClient,
  type GameCompanionSettings,
} from '../src/features/integrations/gameCompanion.ts'

const SAVED_GAMES: GameCompanionSettings = {
  minecraftIntegrationEnabled: true,
  minecraftServerAddress: '127.0.0.1',
  minecraftServerPort: 25565,
  minecraftUsername: 'nexus',
  factorioIntegrationEnabled: true,
  factorioServerAddress: '127.0.0.1',
  factorioServerPort: 34197,
}

function clientThatMustNotConnect(): GameCompanionClient {
  return {
    minecraftConnect: () => {
      throw new Error('startup attempted a Minecraft connection')
    },
    factorioConnect: () => {
      throw new Error('startup attempted a Factorio connection')
    },
    minecraftDisconnect: () => {
      throw new Error('startup attempted a Minecraft disconnect')
    },
    factorioDisconnect: () => {
      throw new Error('startup attempted a Factorio disconnect')
    },
  }
}

test('game companion rows stay hidden and startup does not connect saved games', () => {
  assert.equal(isGameCompanionEnabled(), false)
  assert.equal(isGameCompanionEnabled({}), false)
  assert.equal(isGameCompanionEnabled({ VITE_NEXUS_ENABLE_GAME_COMPANION: 'true' }), false)
  assert.equal(isGameCompanionEnabled({ VITE_NEXUS_ENABLE_GAME_COMPANION: '0' }), false)
  assert.equal(areGameCompanionRowsVisible(), false)

  assert.deepEqual(
    integrationStatusRows().map((row) => row.label),
    ['MCP', 'Telegram', 'Discord'],
  )
  assert.equal(
    integrationStatusRows().some((row) => row.id === 'minecraft' || row.id === 'factorio'),
    false,
  )

  const next = syncGameConnections({
    settings: SAVED_GAMES,
    connected: { minecraft: false, factorio: false },
    client: clientThatMustNotConnect(),
  })

  assert.deepEqual(next, { minecraft: false, factorio: false })
})

test('game companion flag still exposes the rows and the startup connect path', async () => {
  const env = { VITE_NEXUS_ENABLE_GAME_COMPANION: '1' }
  const calls: string[] = []
  const client: GameCompanionClient = {
    minecraftConnect: async (payload) => {
      calls.push(`minecraft:${payload.address}:${payload.port}:${payload.username}`)
    },
    factorioConnect: async (payload) => {
      calls.push(`factorio:${payload.address}:${payload.port}`)
    },
  }

  assert.equal(isGameCompanionEnabled(env), true)
  assert.equal(areGameCompanionRowsVisible(env), true)
  assert.deepEqual(
    integrationStatusRows(env).map((row) => row.label),
    ['MCP', 'Minecraft', 'Factorio', 'Telegram', 'Discord'],
  )

  const next = syncGameConnections({
    settings: SAVED_GAMES,
    connected: { minecraft: false, factorio: false },
    client,
    env,
  })

  await Promise.resolve()
  assert.deepEqual(next, { minecraft: true, factorio: true })
  assert.deepEqual(calls, [
    'minecraft:127.0.0.1:25565:nexus',
    'factorio:127.0.0.1:34197',
  ])
})
