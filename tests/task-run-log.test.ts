import test from 'node:test'
import assert from 'node:assert/strict'

import { agentTraceToTaskRunLog } from '../src/features/tasks/index.ts'
import type { AgentTrace } from '../src/features/agent/agentTraceStore.ts'

test('agentTraceToTaskRunLog maps trace status and tool risk', () => {
  const trace: AgentTrace = {
    id: 'trace-1',
    goal: '整理待办',
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_010_000,
    status: 'done',
    finalResponse: '整理完成',
    steps: [
      {
        iteration: 1,
        type: 'thinking',
        content: '判断任务',
        timestamp: 1_700_000_001_000,
      },
      {
        iteration: 2,
        type: 'tool_round',
        content: '写入文件',
        toolCallNames: ['write_file'],
        timestamp: 1_700_000_002_000,
      },
    ],
  }

  const log = agentTraceToTaskRunLog(trace)

  assert.equal(log.status, 'succeeded')
  assert.equal(log.resultSummary, '整理完成')
  assert.equal(log.steps[0].permissionLevel, 'safe')
  assert.equal(log.steps[1].permissionLevel, 'confirm')
  assert.equal(log.steps[1].reversible, false)
})
