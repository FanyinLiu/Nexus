/**
 * Worker thread for memory vector similarity search.
 * Offloads O(n × embedding_dim) cosine similarity from the main process.
 */
import { parentPort } from 'node:worker_threads'

function cosineSimilarity(left, right) {
  if (!left?.length || !right?.length || left.length !== right.length) return 0

  let dot = 0
  let magL = 0
  let magR = 0
  for (let i = 0; i < left.length; i++) {
    dot += left[i] * right[i]
    magL += left[i] * left[i]
    magR += right[i] * right[i]
  }
  const denom = Math.sqrt(magL) * Math.sqrt(magR)
  return denom === 0 ? 0 : dot / denom
}

parentPort.on('message', (msg) => {
  if (msg.type !== 'search') return

  const { queryEmbedding, entries, limit, threshold, layer, requestId } = msg
  const results = []

  for (const entry of entries) {
    if (layer && entry.layer !== layer) continue

    const score = cosineSimilarity(queryEmbedding, entry.embedding)
    if (score >= threshold) {
      results.push({ id: entry.id, content: entry.content, layer: entry.layer, score })
    }
  }

  results.sort((a, b) => b.score - a.score)

  parentPort.postMessage({
    type: 'search-result',
    requestId,
    results: results.slice(0, limit),
  })
})
