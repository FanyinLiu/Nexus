// @ts-nocheck
/**
 * Pure-C Qwen3-TTS server: discovery, launch spec, and parent-death guard.
 *
 * The C port is preferred over the Python sidecar when its Metal binary and
 * the 1.7B CustomVoice checkpoint exist on this machine. It is a long-lived
 * resident server (~5 GB RSS, ~15 s cold start), so it must never outlive
 * Nexus. On POSIX we launch it through a tiny `/bin/sh` guard that blocks on
 * the parent's stdin pipe: when Electron exits — normally, by crash, or by
 * SIGKILL — the pipe closes, the guard wakes up and terminates the server.
 *
 * The module is dependency-injected so path resolution and launch-spec
 * building are testable without spawning the real 5 GB model.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Preferred ports, in order. The first free one is used. */
export const QWEN3_CPORT_PORTS = Object.freeze([8003, 8004, 8005])

/**
 * The guard blocks on stdin until the Electron parent closes it. A normal
 * quit kills the whole process group first; a crash/force-kill closes the pipe
 * and lands here. Both paths end with the server gone.
 */
export const PARENT_DEATH_GUARD_SCRIPT = [
  '"$@" &',
  'child=$!',
  'cat >/dev/null 2>&1',
  'kill -TERM "$child" 2>/dev/null',
  'sleep 0.2',
  'kill -KILL "$child" 2>/dev/null',
  'wait "$child" 2>/dev/null',
  'exit 0',
].join('\n')

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Resolve the C server binary, checkpoint, backend/quant flags, and ports.
 *
 * `NEXUS_QWEN3_CPORT_BIN`, `NEXUS_QWEN3_CPORT_MODEL`,
 * `NEXUS_QWEN3_CPORT_BACKEND`, `NEXUS_QWEN3_CPORT_QUANT` and
 * `NEXUS_QWEN3_CPORT_PORT` override the defaults; `NEXUS_QWEN3_CPORT_DISABLE=1`
 * forces the Python sidecar (useful for debugging the fallback path).
 *
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   homedir?: () => string,
 *   existsSync?: (filePath: string) => boolean,
 * }} [deps]
 * @returns {{
 *   available: boolean,
 *   binaryPath: string,
 *   modelDir: string,
 *   backend: string,
 *   quant: string,
 *   ports: number[],
 *   reason: string | null,
 * }}
 */
export function resolveQwen3CportConfig(deps = {}) {
  const env = deps.env ?? process.env
  const homedir = deps.homedir ?? os.homedir
  const existsSync = deps.existsSync ?? fs.existsSync

  const binaryPath = isNonEmptyString(env.NEXUS_QWEN3_CPORT_BIN)
    ? env.NEXUS_QWEN3_CPORT_BIN.trim()
    : path.join(homedir(), 'Models', 'qwen3-tts-c', 'src', 'qwen_tts')
  const modelDir = isNonEmptyString(env.NEXUS_QWEN3_CPORT_MODEL)
    ? env.NEXUS_QWEN3_CPORT_MODEL.trim()
    : path.join(homedir(), 'Models', 'qwen3-tts', 'Qwen3-TTS-12Hz-1.7B-CustomVoice')
  const backend = isNonEmptyString(env.NEXUS_QWEN3_CPORT_BACKEND)
    ? env.NEXUS_QWEN3_CPORT_BACKEND.trim()
    : 'metal'
  const quant = isNonEmptyString(env.NEXUS_QWEN3_CPORT_QUANT)
    ? env.NEXUS_QWEN3_CPORT_QUANT.trim()
    : 'int4'

  const forcedPort = Number(env.NEXUS_QWEN3_CPORT_PORT)
  const ports = Number.isInteger(forcedPort) && forcedPort > 0
    ? [forcedPort]
    : [...QWEN3_CPORT_PORTS]

  if (String(env.NEXUS_QWEN3_CPORT_DISABLE ?? '').trim() === '1') {
    return {
      available: false,
      binaryPath,
      modelDir,
      backend,
      quant,
      ports,
      reason: 'disabled by NEXUS_QWEN3_CPORT_DISABLE',
    }
  }

  const hasBinary = existsSync(binaryPath)
  const hasModel = existsSync(modelDir)
  return {
    available: hasBinary && hasModel,
    binaryPath,
    modelDir,
    backend,
    quant,
    ports,
    reason: hasBinary && hasModel
      ? null
      : `missing ${hasBinary ? 'model directory' : 'C binary'}`,
  }
}

/**
 * The fastest launch verified in RESULTS.md: Metal fused talker, int4, fixed
 * seed. Only the resident server is used — one-shot CLI mode peaks at 12 GB.
 * Backend/quant come from the resolved config so another build can opt out of
 * Metal without editing code; `quant: 'none'` omits the flag.
 *
 * @param {{ modelDir: string, backend?: string, quant?: string }} config
 * @param {number} port
 * @returns {string[]}
 */
export function buildQwen3CportArgs(config, port) {
  const backend = isNonEmptyString(config.backend) ? config.backend.trim() : 'metal'
  const quant = isNonEmptyString(config.quant) ? config.quant.trim() : 'int4'
  const quantFlag = quant === 'none'
    ? []
    : [quant.startsWith('--') ? quant : `--${quant}`]
  return [
    '-d', config.modelDir,
    ...quantFlag,
    '--backend', backend,
    '--serve', String(port),
    '--seed', '42',
  ]
}

/**
 * Environment for the C server. `QWEN_METAL_FUSED_TALKER=1` is required for
 * the fast Metal path; without it the same binary uses a slower matvec seam.
 *
 * @param {Record<string, string | undefined>} baseEnv
 * @returns {Record<string, string | undefined>}
 */
export function buildQwen3CportEnv(baseEnv = process.env) {
  return { ...baseEnv, QWEN_METAL_FUSED_TALKER: '1' }
}

/**
 * Loopback-only base URL for a running C server.
 *
 * @param {number} port
 * @returns {string}
 */
export function buildQwen3CportBaseUrl(port) {
  return `http://127.0.0.1:${port}/v1`
}

/**
 * True when an lsof listen address (or a bare interface host) is loopback.
 * Wildcards, `0.0.0.0`, and `::` are treated as publicly reachable.
 *
 * @param {string} address
 * @returns {boolean}
 */
export function isLoopbackListenAddress(address) {
  const value = String(address ?? '').trim().toLowerCase()
  if (!value) return false
  let host = value
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    if (end > 0) host = host.slice(1, end)
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/u.test(host)) {
    host = host.slice(0, host.lastIndexOf(':'))
  } else if (/^[^:]+:\d+$/u.test(host)) {
    host = host.slice(0, host.lastIndexOf(':'))
  }
  if (host === '*' || host === '0.0.0.0' || host === '::' || host === 'any') return false
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') return true
  return /^127(?:\.\d{1,3}){3}$/u.test(host)
}

/**
 * Pull listen addresses out of `lsof -Fn` output (one `n…` line per socket).
 *
 * @param {string} stdout
 * @returns {string[]}
 */
export function parseLsofListenAddresses(stdout) {
  return String(stdout ?? '')
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('n'))
    .map((line) => line.slice(1).trim())
    .filter(Boolean)
}

/**
 * Verify the C server listens only on loopback. lsof is the fast path; when
 * it is unavailable (Windows / missing binary / permission), probe the
 * machine's non-loopback interface addresses instead. Fail closed on any
 * reachable non-loopback listener.
 *
 * @param {{
 *   port: number,
 *   listListenAddresses: (port: number) => Promise<string[] | null>,
 *   listInterfaceAddresses: () => string[],
 *   connect: (host: string, port: number) => Promise<boolean>,
 * }} deps
 * @returns {Promise<boolean>}
 */
export async function isQwen3CportLoopbackOnly(deps) {
  let listenAddresses
  try {
    listenAddresses = await deps.listListenAddresses(deps.port)
  } catch {
    listenAddresses = null
  }
  if (Array.isArray(listenAddresses) && listenAddresses.length > 0) {
    return listenAddresses.every(isLoopbackListenAddress)
  }

  const candidates = deps.listInterfaceAddresses()
    .filter((address) => !isLoopbackListenAddress(address))
  if (!candidates.length) return true
  const reachable = await Promise.all(
    candidates.map((address) => deps.connect(address, deps.port).catch(() => false)),
  )
  return !reachable.some(Boolean)
}

/**
 * Wrap the server command in the parent-death guard.
 *
 * On Windows the POSIX-shell guard is unavailable; the caller spawns the
 * server directly and the normal quit path still group-kills it. The guard is
 * what covers crash/force-kill, so it is only claimed on POSIX.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ platform?: string }} [options]
 * @returns {{ command: string, args: string[], guarded: boolean }}
 */
export function buildParentDeathGuardLaunch(command, args, options = {}) {
  const platform = options.platform ?? process.platform
  if (platform === 'win32') {
    return { command, args: [...args], guarded: false }
  }
  return {
    command: '/bin/sh',
    args: ['-c', PARENT_DEATH_GUARD_SCRIPT, 'nexus-qwen3-guard', command, ...args],
    guarded: true,
  }
}

/**
 * Map a renderer language tag to a name the C server understands.
 *
 * The C table only knows full English names; an unknown value is ignored by
 * the server, which would silently fall back to the model default. Returning
 * undefined keeps the request honest (let the server use its default) instead
 * of sending a value that will be discarded.
 *
 * @param {unknown} language
 * @returns {string | undefined}
 */
export function mapQwen3CportLanguage(language) {
  const raw = String(language ?? '').trim().toLowerCase()
  if (!raw) return undefined
  if (/^(zh|cmn)/u.test(raw) || raw === '中文') return 'Chinese'
  if (/^en/u.test(raw) || raw === 'english') return 'English'
  if (/^ja/u.test(raw) || raw === '日本語') return 'Japanese'
  if (/^ko/u.test(raw) || raw === '한국어') return 'Korean'
  if (/^fr/u.test(raw) || raw === 'french') return 'French'
  if (/^de/u.test(raw) || raw === 'german') return 'German'
  if (/^es/u.test(raw) || raw === 'spanish') return 'Spanish'
  if (/^it/u.test(raw) || raw === 'italian') return 'Italian'
  if (/^pt/u.test(raw) || raw === 'portuguese') return 'Portuguese'
  if (/^ru/u.test(raw) || raw === 'russian') return 'Russian'
  return undefined
}
