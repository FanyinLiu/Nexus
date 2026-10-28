import type { TranslationKey } from '../../types/i18n.ts'
import {
  isAutoMemoryEmbeddingModel,
  type AutoMemoryEmbeddingState,
} from './memoryEmbeddingAuto.ts'
import {
  QWEN3_EMBEDDING_OLLAMA_MODEL,
  describeOllamaEmbedFailure,
  getOllamaModelName,
  isOllamaMemoryModel,
  type MemoryEmbeddingBackendStatus,
} from './ollamaEmbedding.ts'

export type MemoryEmbeddingStatusView = {
  tone: 'success' | 'warning' | 'info'
  key: TranslationKey
  params: Record<string, string | number>
}

/**
 * Auto mode always has a status line: which model is in use right now and,
 * when Ollama is up but the model is missing, the pull command.
 */
export function resolveAutoMemoryEmbeddingStatusView(state: AutoMemoryEmbeddingState): MemoryEmbeddingStatusView {
  switch (state.phase) {
    case 'active':
      return { tone: 'success', key: 'memory.embedding.auto.status.active', params: {} }
    case 'indexing':
      return { tone: 'info', key: 'memory.embedding.auto.status.indexing', params: {} }
    case 'fallback':
      return { tone: 'warning', key: 'memory.embedding.auto.status.fallback', params: {} }
    case 'unavailable':
      return state.reason === 'not-installed'
        ? { tone: 'info', key: 'memory.embedding.auto.status.not_installed', params: { model: QWEN3_EMBEDDING_OLLAMA_MODEL } }
        : { tone: 'info', key: 'memory.embedding.auto.status.unreachable', params: {} }
    default:
      return { tone: 'info', key: 'memory.embedding.auto.status.detecting', params: {} }
  }
}

/**
 * What the memory settings should say about the selected embedding model's
 * backend. Auto and Ollama models have a live status; others return null.
 */
export function resolveMemoryEmbeddingStatusView(
  selectedModel: string,
  status: MemoryEmbeddingBackendStatus,
  translate: (key: TranslationKey, params?: Record<string, string | number>) => string,
  autoState?: AutoMemoryEmbeddingState,
): MemoryEmbeddingStatusView | null {
  if (autoState && isAutoMemoryEmbeddingModel(selectedModel)) {
    return resolveAutoMemoryEmbeddingStatusView(autoState)
  }
  if (!isOllamaMemoryModel(selectedModel)) return null
  if (status.state === 'idle' || status.model !== selectedModel) return null

  if (status.state === 'ready') {
    return { tone: 'success', key: 'memory.embedding.status.ready', params: { dimensions: status.dimensions } }
  }

  const notice = describeOllamaEmbedFailure(status.code, getOllamaModelName(selectedModel))
  const reason = translate(notice.key, notice.params)
  return { tone: 'warning', key: 'memory.embedding.status.fallback', params: { reason } }
}
