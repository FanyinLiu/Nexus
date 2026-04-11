/**
 * Semantic clustering for long-term memories.
 *
 * Groups memories into clusters based on content similarity using a lightweight
 * Jaccard + token overlap approach (no embeddings required). Runs during dream
 * cycles to organize memories into coherent topic groups.
 *
 * Algorithm: agglomerative average-linkage clustering with a fixed similarity
 * threshold, operating on token sets for O(n²) comparisons.
 */

import type { MemoryCluster, MemoryItem } from '../../types'

const CLUSTER_SIMILARITY_THRESHOLD = 0.25
const MIN_CLUSTER_SIZE = 2
const MAX_CLUSTERS = 30

// ── Tokenization ──────────────────────────────────────────────────────────

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>()
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')
  for (const word of normalized.split(/\s+/)) {
    if (word.length >= 2) tokens.add(word)
  }
  return tokens
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a]
  for (const token of smaller) {
    if (larger.has(token)) intersection++
  }
  const union = a.size + b.size - intersection
  return union > 0 ? intersection / union : 0
}

// ── Clustering ────────────────────────────────────────────────────────────

type ClusterNode = {
  memberIndices: number[]
}

/**
 * Compute average-linkage similarity between two clusters.
 * Average of all pairwise Jaccard similarities between members.
 */
function averageLinkage(a: ClusterNode, b: ClusterNode, tokenSets: Set<string>[]): number {
  let totalSim = 0
  let pairs = 0
  for (const ai of a.memberIndices) {
    for (const bi of b.memberIndices) {
      totalSim += jaccardSimilarity(tokenSets[ai], tokenSets[bi])
      pairs++
    }
  }
  return pairs > 0 ? totalSim / pairs : 0
}

/**
 * Cluster memories by content similarity.
 * Returns an array of MemoryCluster objects.
 */
export function clusterMemories(memories: MemoryItem[]): MemoryCluster[] {
  if (memories.length < MIN_CLUSTER_SIZE) return []

  // Tokenize all memories
  const tokenSets = memories.map((m) => tokenize(m.content))

  // Initialize each memory as its own cluster
  const nodes: ClusterNode[] = memories.map((_, i) => ({
    memberIndices: [i],
  }))

  // Agglomerative merging (average-linkage)
  let merged = true
  while (merged) {
    merged = false
    let bestSim = CLUSTER_SIMILARITY_THRESHOLD
    let bestI = -1
    let bestJ = -1

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const sim = averageLinkage(nodes[i], nodes[j], tokenSets)
        if (sim > bestSim) {
          bestSim = sim
          bestI = i
          bestJ = j
        }
      }
    }

    if (bestI >= 0 && bestJ >= 0) {
      // Merge j into i
      nodes[bestI] = {
        memberIndices: [...nodes[bestI].memberIndices, ...nodes[bestJ].memberIndices],
      }
      nodes.splice(bestJ, 1)
      merged = true
    }
  }

  // Filter and build output
  const now = new Date().toISOString()
  const clusters: MemoryCluster[] = []

  for (const node of nodes) {
    if (node.memberIndices.length < MIN_CLUSTER_SIZE) continue

    const members = node.memberIndices.map((i) => memories[i])
    // Pick the longest content as the centroid representative
    const centroid = members.reduce((a, b) => (a.content.length >= b.content.length ? a : b))
    // Build a label from the most common tokens
    const allTokens = new Set<string>()
    for (const i of node.memberIndices) {
      for (const t of tokenSets[i]) allTokens.add(t)
    }
    const label = buildClusterLabel(allTokens)

    clusters.push({
      id: `cluster-${crypto.randomUUID().slice(0, 8)}`,
      label,
      memberIds: members.map((m) => m.id),
      centroidContent: centroid.content.slice(0, 200),
      createdAt: now,
      updatedAt: now,
    })
  }

  // Sort by size descending, limit
  clusters.sort((a, b) => b.memberIds.length - a.memberIds.length)
  return clusters.slice(0, MAX_CLUSTERS)
}

function buildClusterLabel(tokens: Set<string>): string {
  // Return top 3 longest tokens as a rough label
  const sorted = [...tokens].sort((a, b) => b.length - a.length)
  return sorted.slice(0, 3).join(' / ')
}

/**
 * Assign a memory to the best matching existing cluster (if similarity exceeds threshold).
 * Returns the cluster ID or null if no match.
 */
export function findBestCluster(
  memory: MemoryItem,
  clusters: MemoryCluster[],
  _allMemories: MemoryItem[],
): string | null {
  if (clusters.length === 0) return null

  const memTokens = tokenize(memory.content)
  let bestClusterId: string | null = null
  let bestSim = CLUSTER_SIMILARITY_THRESHOLD

  for (const cluster of clusters) {
    // Compare against centroid content
    const centroidTokens = tokenize(cluster.centroidContent)
    const sim = jaccardSimilarity(memTokens, centroidTokens)
    if (sim > bestSim) {
      bestSim = sim
      bestClusterId = cluster.id
    }
  }

  return bestClusterId
}
