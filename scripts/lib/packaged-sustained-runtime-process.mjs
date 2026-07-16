/**
 * Process-tree sampling, termination, and child-exit reporting for the
 * packaged sustained runtime harness.
 */

import { execFileSync } from 'node:child_process'

function collectDescendantPids(pid, result = []) {
  if (!pid || process.platform === 'win32') return result
  let childPids = []
  try {
    childPids = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0)
  } catch {
    return result
  }
  for (const childPid of childPids) {
    collectDescendantPids(childPid, result)
    result.push(childPid)
  }
  return result
}

function sleepSync(ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    // Intentional short busy-wait only used during process teardown.
  }
}

/**
 * Terminate process tree. Returns truthful termination metadata —
 * never claim a natural exit when the harness killed the child.
 */
export function terminateTree(rootPid) {
  if (!rootPid) {
    return {
      attempted: false,
      terminatedByHarness: false,
      method: null,
      signalSent: null,
    }
  }
  const descendants = collectDescendantPids(rootPid)
  let anyAliveBefore = false
  for (const pid of [rootPid, ...descendants]) {
    try {
      process.kill(pid, 0)
      anyAliveBefore = true
    } catch {
      // already gone
    }
  }
  if (!anyAliveBefore) {
    return {
      attempted: false,
      terminatedByHarness: false,
      method: null,
      signalSent: null,
      note: 'process tree already exited before harness terminate',
    }
  }

  for (const pid of [...descendants, rootPid]) {
    try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ }
  }

  const deadline = Date.now() + 1500
  while (Date.now() < deadline) {
    let alive = false
    for (const pid of [rootPid, ...descendants]) {
      try {
        process.kill(pid, 0)
        alive = true
      } catch {
        // dead
      }
    }
    if (!alive) {
      return {
        attempted: true,
        terminatedByHarness: true,
        method: 'SIGTERM',
        signalSent: 'SIGTERM',
        note: 'harness sent SIGTERM; process tree exited during grace period',
      }
    }
    sleepSync(50)
  }

  for (const pid of [...descendants, rootPid]) {
    try { process.kill(pid, 'SIGKILL') } catch { /* gone */ }
  }
  return {
    attempted: true,
    terminatedByHarness: true,
    method: 'SIGTERM_then_SIGKILL',
    signalSent: 'SIGKILL',
    note: 'harness escalated to SIGKILL after SIGTERM grace period',
  }
}

/**
 * Build childExit report. If the harness terminated the process, never claim
 * a natural/clean exit even when exitCode happens to be 0.
 */
export function buildChildExitReport({
  exitCode = null,
  signalCode = null,
  termination = null,
  waitedForExit = false,
} = {}) {
  const terminatedByHarness = Boolean(termination?.terminatedByHarness)
  let disposition = 'unknown'
  if (terminatedByHarness) {
    disposition = 'killed_by_harness'
  } else if (exitCode === 0 && !signalCode) {
    disposition = 'exited_naturally'
  } else if (exitCode != null || signalCode) {
    disposition = 'exited_before_harness_cleanup'
  } else if (!waitedForExit) {
    disposition = 'not_observed'
  }

  let note = null
  if (terminatedByHarness) {
    note = termination?.note || 'harness terminated the packaged app process tree'
    if (exitCode === 0) {
      note += '; exitCode 0 after harness termination must not be read as natural success'
    }
  } else if (disposition === 'exited_naturally') {
    note = 'child exited on its own before harness cleanup'
  } else {
    note = termination?.note || null
  }

  return {
    exitCode: exitCode ?? null,
    signalCode: signalCode ?? null,
    terminatedByHarness,
    disposition,
    terminationMethod: termination?.method ?? null,
    signalSentByHarness: termination?.signalSent ?? null,
    note,
  }
}

function classifyProcessRole(command) {
  const text = String(command || '').toLowerCase()
  if (text.includes('gpu')) return 'gpu'
  if (text.includes('renderer')) return 'renderer'
  if (text.includes('plugin')) return 'plugin'
  if (text.includes('utility')) return 'utility'
  if (text.includes('helper')) return 'helper'
  return 'main_or_other'
}

/**
 * Sample process tree RSS/CPU via `ps`. RSS is kilobytes on macOS/Linux.
 * Returns null when the root pid is gone.
 */
export function sampleProcessTree(rootPid) {
  if (!rootPid) return null
  const pids = [rootPid, ...collectDescendantPids(rootPid)]
  const unique = [...new Set(pids)].filter((pid) => Number.isInteger(pid) && pid > 0)
  if (unique.length === 0) return null

  let stdout = ''
  try {
    if (process.platform === 'win32') {
      stdout = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          unique.map((pid) => (
            `try { $p=Get-Process -Id ${pid} -ErrorAction Stop; ` +
            `\"${pid} 0 $($p.CPU) $([int]($p.WorkingSet64/1KB)) $($p.ProcessName)\" } catch {}`
          )).join('; '),
        ],
        { encoding: 'utf8' },
      )
    } else {
      stdout = execFileSync(
        'ps',
        ['-o', 'pid=,ppid=,%cpu=,rss=,comm=', '-p', unique.join(',')],
        { encoding: 'utf8' },
      )
    }
  } catch {
    return null
  }

  const processes = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/)
    if (!match) continue
    const pid = Number.parseInt(match[1], 10)
    const ppid = Number.parseInt(match[2], 10)
    const cpuPercent = Number.parseFloat(match[3])
    const rssKb = Number.parseInt(match[4], 10)
    const command = match[5].trim()
    processes.push({
      pid,
      ppid,
      cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : 0,
      rssKb: Number.isFinite(rssKb) ? rssKb : 0,
      command,
      role: classifyProcessRole(command),
    })
  }

  if (processes.length === 0) return null

  const byRole = {}
  let totalRssKb = 0
  let totalCpuPercent = 0
  for (const proc of processes) {
    totalRssKb += proc.rssKb
    totalCpuPercent += proc.cpuPercent
    const bucket = byRole[proc.role] ?? { count: 0, rssKb: 0, cpuPercent: 0 }
    bucket.count += 1
    bucket.rssKb += proc.rssKb
    bucket.cpuPercent += proc.cpuPercent
    byRole[proc.role] = bucket
  }

  return {
    at: new Date().toISOString(),
    rootPid,
    processCount: processes.length,
    totalRssKb,
    totalCpuPercent: Number(totalCpuPercent.toFixed(2)),
    byRole,
    processes,
  }
}
