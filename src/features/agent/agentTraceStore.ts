import {
  AGENT_TRACE_STORAGE_KEY,
  createId,
  readJsonValidated,
  writeJsonDebounced,
} from '../../lib/storage/core.ts'
import type { AgentStep, AgentStopReason, AgentStepType } from './agentLoop.ts'

export type AgentTrace = {
  id: string
  goal: string
  startedAt: number
  endedAt?: number
  status?: AgentStopReason
  steps: AgentStep[]
  finalResponse?: string
  planId?: string
}

export type AgentTraceListener = (traces: AgentTrace[]) => void

const MAX_TRACES = 20
const AGENT_STEP_TYPES = new Set<AgentStepType>([
  'start',
  'thinking',
  'tool_round',
  'plan_created',
  'plan_step_done',
  'reflect',
  'continue',
  'done',
  'abort',
])
const AGENT_STOP_REASONS = new Set<AgentStopReason>([
  'done',
  'aborted',
  'max_iterations',
  'cost_cap',
  'error',
])

function cloneStep(step: AgentStep): AgentStep {
  return {
    ...step,
    ...(step.toolCallNames ? { toolCallNames: [...step.toolCallNames] } : {}),
  }
}

function cloneTrace(trace: AgentTrace): AgentTrace {
  return {
    ...trace,
    steps: trace.steps.map(cloneStep),
  }
}

function normalizeAgentStep(value: unknown): AgentStep | null {
  if (!value || typeof value !== 'object') return null
  const step = value as Partial<AgentStep>
  if (typeof step.iteration !== 'number' || !Number.isFinite(step.iteration)) return null
  if (!AGENT_STEP_TYPES.has(step.type as AgentStepType)) return null
  if (typeof step.timestamp !== 'number' || !Number.isFinite(step.timestamp)) return null
  return {
    iteration: step.iteration,
    type: step.type as AgentStepType,
    timestamp: step.timestamp,
    ...(typeof step.content === 'string' ? { content: step.content } : {}),
    ...(Array.isArray(step.toolCallNames)
      ? { toolCallNames: step.toolCallNames.filter((name): name is string => typeof name === 'string') }
      : {}),
    ...(typeof step.reason === 'string' ? { reason: step.reason } : {}),
  }
}

function normalizeAgentTrace(value: unknown): AgentTrace | null {
  if (!value || typeof value !== 'object') return null
  const trace = value as Partial<AgentTrace>
  if (typeof trace.id !== 'string' || typeof trace.goal !== 'string') return null
  if (typeof trace.startedAt !== 'number' || !Number.isFinite(trace.startedAt)) return null
  const steps = Array.isArray(trace.steps)
    ? trace.steps.map(normalizeAgentStep).filter((step): step is AgentStep => Boolean(step))
    : []
  const status = AGENT_STOP_REASONS.has(trace.status as AgentStopReason)
    ? trace.status as AgentStopReason
    : undefined
  const endedAt = typeof trace.endedAt === 'number' && Number.isFinite(trace.endedAt)
    ? trace.endedAt
    : undefined

  return {
    id: trace.id,
    goal: trace.goal,
    startedAt: trace.startedAt,
    // A trace persisted without terminal status means the app exited or
    // reloaded while the loop was in flight. There is no live runner after
    // hydrate, so surface it as aborted instead of leaving the UI "running"
    // forever.
    status: status ?? 'aborted',
    endedAt: endedAt ?? Date.now(),
    steps,
    ...(typeof trace.finalResponse === 'string' ? { finalResponse: trace.finalResponse } : {}),
    ...(typeof trace.planId === 'string' ? { planId: trace.planId } : {}),
  }
}

class AgentTraceStoreImpl {
  private traces: AgentTrace[] = []
  private listeners = new Set<AgentTraceListener>()
  private hydrated = false

  hydrate(): void {
    if (this.hydrated) return
    this.traces = readJsonValidated<AgentTrace[]>(AGENT_TRACE_STORAGE_KEY, [], (parsed) => (
      Array.isArray(parsed)
        ? parsed.map(normalizeAgentTrace).filter((trace): trace is AgentTrace => Boolean(trace))
        : null
    ))
    this.hydrated = true
  }

  list(): AgentTrace[] {
    this.hydrate()
    return this.traces.map(cloneTrace)
  }

  get(id: string): AgentTrace | undefined {
    this.hydrate()
    const trace = this.traces.find((t) => t.id === id)
    return trace ? cloneTrace(trace) : undefined
  }

  start(goal: string): AgentTrace {
    this.hydrate()
    const trace: AgentTrace = {
      id: createId('trace'),
      goal,
      startedAt: Date.now(),
      steps: [],
    }
    this.traces.unshift(trace)
    while (this.traces.length > MAX_TRACES) this.traces.pop()
    this.persist()
    return cloneTrace(trace)
  }

  appendStep(traceId: string, step: AgentStep): void {
    this.hydrate()
    const idx = this.traces.findIndex((t) => t.id === traceId)
    if (idx < 0) return
    const next: AgentTrace = {
      ...this.traces[idx],
      steps: [...this.traces[idx].steps, cloneStep(step)],
    }
    this.traces[idx] = next
    this.persist()
  }

  finish(traceId: string, info: {
    status: AgentStopReason
    finalResponse?: string
    planId?: string
  }): void {
    this.hydrate()
    const idx = this.traces.findIndex((t) => t.id === traceId)
    if (idx < 0) return
    const next: AgentTrace = {
      ...this.traces[idx],
      endedAt: Date.now(),
      status: info.status,
      finalResponse: info.finalResponse,
      planId: info.planId,
    }
    this.traces[idx] = next
    this.persist()
  }

  remove(traceId: string): void {
    this.hydrate()
    const before = this.traces.length
    this.traces = this.traces.filter((t) => t.id !== traceId)
    if (this.traces.length !== before) this.persist()
  }

  clear(): void {
    this.traces = []
    this.hydrated = true
    this.persist()
  }

  subscribe(listener: AgentTraceListener): () => void {
    this.hydrate()
    this.listeners.add(listener)
    listener(this.list())
    return () => {
      this.listeners.delete(listener)
    }
  }

  private persist(): void {
    writeJsonDebounced(AGENT_TRACE_STORAGE_KEY, this.traces)
    const snapshot = this.list()
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch {
        // listener errors must not break the store
      }
    }
  }
}

export const agentTraceStore = new AgentTraceStoreImpl()
