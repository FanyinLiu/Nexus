// @ts-check
import { app, BrowserWindow, ipcMain, session } from 'electron'
import { clearMemoryUserData } from '../services/memoryUserDataClear.js'
import { createMemoryFlushAckGate, createMemoryQuitFlushHandler } from '../services/memoryFlushAckGate.js'
import { isUpdateInstallQuit } from '../services/updateInstallQuitFlag.js'
import * as memoryVectorStore from '../services/memoryVectorStore.js'
import {
  createLongTermMemoryFileStore,
  resolveLongTermMemoryFilePath,
} from '../services/longTermMemoryFileStore.js'
import { detectOllamaModel, embedWithOllama } from '../services/ollamaEmbed.js'
import { performNetworkRequest } from '../net.js'
import { requireTrustedSender } from './validate.js'
import {
  validateMemoryClearUserDataPayload,
  validateMemoryHybridSearchPayload,
  validateMemoryKeywordSearchPayload,
  validateMemoryLongTermSavePayload,
  validateMemoryOllamaDetectPayload,
  validateMemoryOllamaEmbedPayload,
  validateMemoryRemovePayload,
  validateMemoryVectorIndexBatchPayload,
  validateMemoryVectorIndexPayload,
  validateMemoryVectorSearchPayload,
} from './payloadSchemas.js'

const MEMORY_FLUSH_QUIT_TIMEOUT_MS = 2_500

export function register() {
  const longTermMemoryStore = createLongTermMemoryFileStore({
    filePath: resolveLongTermMemoryFilePath(app.getPath('userData')),
  })
  const flushGate = createMemoryFlushAckGate()

  // The renderer buffers memory writes for 250 ms; `beforeunload` cannot await
  // the IPC save. Block the first quit so the debounced value lands on disk,
  // but never longer than the timeout if a renderer is gone. An update install
  // owns its quit, so the handler lets that one through untouched.
  app.on('before-quit', createMemoryQuitFlushHandler({
    getWindows: () => BrowserWindow.getAllWindows(),
    gate: flushGate,
    timeoutMs: MEMORY_FLUSH_QUIT_TIMEOUT_MS,
    quit: () => app.quit(),
    isUpdateInstallQuit,
  }))

  ipcMain.handle('memory:flush-complete', async (event) => {
    requireTrustedSender(event)
    flushGate.acknowledge()
    return { ok: true }
  })

  ipcMain.handle('memory:long-term-load', async (event) => {
    requireTrustedSender(event)
    return longTermMemoryStore.load()
  })

  ipcMain.handle('memory:long-term-save', async (event, payload) => {
    requireTrustedSender(event)
    const parsed = validateMemoryLongTermSavePayload(payload)
    return longTermMemoryStore.save(parsed?.memories ?? [])
  })

  ipcMain.handle('memory:long-term-clear', async (event) => {
    requireTrustedSender(event)
    return longTermMemoryStore.clear()
  })

  // Chromium keeps removed localStorage values in LevelDB tombstones. Only the
  // session-level clear compacts them away; the renderer restores every
  // non-memory key afterwards.
  ipcMain.handle('memory:reset-local-storage', async (event) => {
    requireTrustedSender(event)
    await session.defaultSession.clearStorageData({ storages: ['localstorage'] })
    return { ok: true }
  })

  ipcMain.handle('memory:vector-index', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateMemoryVectorIndexPayload(payload)
    const { id, content, embedding, layer, model } = payload ?? {}
    await memoryVectorStore.indexMemory(id, content, embedding, layer, model)
    return { ok: true }
  })

  ipcMain.handle('memory:vector-index-batch', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateMemoryVectorIndexBatchPayload(payload)
    await memoryVectorStore.indexBatch(payload)
    return { ok: true, count: payload.length }
  })

  ipcMain.handle('memory:vector-search', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateMemoryVectorSearchPayload(payload)
    const { queryEmbedding, limit, threshold, layer, model } = payload ?? {}
    return memoryVectorStore.searchSimilar(queryEmbedding, { limit, threshold, layer, model })
  })

  ipcMain.handle('memory:vector-remove', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateMemoryRemovePayload(payload)
    if (Array.isArray(payload?.ids)) {
      const count = await memoryVectorStore.removeMemories(payload.ids)
      return { ok: true, count }
    }
    const deleted = await memoryVectorStore.removeMemory(String(payload?.id ?? ''))
    return { ok: deleted }
  })

  ipcMain.handle('memory:vector-stats', async (event) => {
    requireTrustedSender(event)
    return memoryVectorStore.getStats()
  })

  ipcMain.handle('memory:clear-user-data', async (event, payload) => {
    requireTrustedSender(event)
    const parsed = validateMemoryClearUserDataPayload(payload)
    const cleared = await clearMemoryUserData({
      userDataPath: app.getPath('userData'),
      needles: parsed?.needles ?? [],
      // Flush first so the log scrub sees the renderer's already-scrubbed
      // values and can drop the older records that still quote them.
      flushStorage: () => session.defaultSession?.flushStorageData?.(),
    })
    return {
      ok: true,
      removed: cleared.removed,
      localDataCleared: cleared.localDataCleared,
      snapshotMemoryFilesRemoved: cleared.snapshotMemoryFilesRemoved,
    }
  })

  ipcMain.handle('memory:keyword-search', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateMemoryKeywordSearchPayload(payload)
    const { query, limit, threshold, layer } = payload ?? {}
    return memoryVectorStore.searchKeyword(query, { limit, threshold, layer })
  })

  ipcMain.handle('memory:hybrid-search', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateMemoryHybridSearchPayload(payload)
    const { queryEmbedding, queryText, limit, threshold, layer, model } = payload ?? {}
    return memoryVectorStore.searchHybrid(queryEmbedding, queryText, { limit, threshold, layer, model })
  })

  // Memory embeddings from a local Ollama (e.g. qwen3-embedding:0.6b). The
  // renderer CSP blocks plain-http fetches, so the request runs here.
  ipcMain.handle('memory:ollama-embed', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateMemoryOllamaEmbedPayload(payload)
    return embedWithOllama(payload, performNetworkRequest)
  })

  // Auto memory embedding: is Ollama up and is the embedding model pulled?
  // GET /api/tags with a short timeout; never pulls a model.
  ipcMain.handle('memory:ollama-detect', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateMemoryOllamaDetectPayload(payload)
    return detectOllamaModel(payload, performNetworkRequest)
  })
}
