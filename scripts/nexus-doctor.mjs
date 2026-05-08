#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const previewUrl = process.env.NEXUS_PREVIEW_URL || 'http://127.0.0.1:47821/'
const ollamaBaseUrl = (process.env.NEXUS_OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1').replace(/\/+$/, '')
const defaultOllamaModel = process.env.NEXUS_OLLAMA_MODEL || 'qwen3:8b'
const rawProviderMode = getFlagValue('--provider') || process.env.NEXUS_DOCTOR_PROVIDER || 'auto'
const providerMode = normalizeProviderMode(rawProviderMode)

const counters = {
  ok: 0,
  warn: 0,
  error: 0,
  info: 0,
}

function print(status, title, detail = '') {
  counters[status] += 1
  const tag = {
    ok: 'OK',
    warn: 'WARN',
    error: 'ERR',
    info: 'INFO',
  }[status]

  console.log(`[${tag}] ${title}`)
  if (detail) {
    console.log(`     ${detail}`)
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function getFlagValue(name) {
  const exactIndex = process.argv.indexOf(name)
  if (exactIndex >= 0 && process.argv[exactIndex + 1]) {
    return process.argv[exactIndex + 1]
  }

  const prefix = `${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match ? match.slice(prefix.length) : ''
}

function normalizeProviderMode(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'ollama' || normalized === 'deepseek' || normalized === 'auto') {
    return normalized
  }
  return 'auto'
}

function isDeepSeekConfigured() {
  return Boolean(process.env.DEEPSEEK_API_KEY?.trim())
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 1800) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function checkPreviewServer() {
  try {
    const response = await fetchWithTimeout(previewUrl, { method: 'HEAD' })
    if (response.ok) {
      print('ok', 'Nexus 预览服务可访问', `${previewUrl} 返回 HTTP ${response.status}。`)
      return
    }
    print('warn', 'Nexus 预览服务返回异常状态', `${previewUrl} 返回 HTTP ${response.status}。`)
  } catch {
    print(
      'warn',
      'Nexus 预览服务未运行',
      `预览地址应是 ${previewUrl}。运行 npm run dev 或 npm run electron:dev；不要把 ${ollamaBaseUrl} 当成网页预览。`,
    )
  }
}

async function checkOllama() {
  const missingSeverity = providerMode === 'deepseek' || isDeepSeekConfigured() ? 'info' : 'warn'
  const modelsUrl = `${ollamaBaseUrl}/models`
  try {
    const response = await fetchWithTimeout(modelsUrl)
    if (!response.ok) {
      print('warn', 'Ollama API 返回异常状态', `${modelsUrl} 返回 HTTP ${response.status}。`)
      return
    }

    const payload = await response.json()
    const models = Array.isArray(payload?.data)
      ? payload.data.map((item) => String(item?.id ?? '')).filter(Boolean)
      : []
    if (!models.length) {
      print('warn', 'Ollama 已连接但没有返回模型', `建议先运行 ollama pull ${defaultOllamaModel}。`)
      return
    }
    if (models.includes(defaultOllamaModel)) {
      print('ok', 'Ollama 文本模型就绪', `${defaultOllamaModel} 已安装。`)
      return
    }
    print(
      'warn',
      'Ollama 已连接但缺少默认模型',
      `当前模型: ${models.slice(0, 5).join(', ')}。默认建议运行 ollama pull ${defaultOllamaModel}。`,
    )
  } catch {
    print(
      missingSeverity,
      missingSeverity === 'warn' ? 'Ollama API 未连接' : 'Ollama API 未连接，但当前文本路径可跳过',
      `如果走本地模型，请先启动 Ollama 并确认 ${modelsUrl} 可访问；如果走 DeepSeek，可以忽略这一项。`,
    )
  }
}

function checkRepository() {
  const packageJsonPath = path.join(repoRoot, 'package.json')
  const packageJson = readJson(packageJsonPath)

  if (!packageJson) {
    print('error', '没有找到 package.json', `脚本期望在 Nexus 仓库内运行：${repoRoot}`)
    return
  }

  print('ok', '仓库目录可识别', `${packageJson.name ?? 'nexus'}@${packageJson.version ?? 'unknown'}`)

  const electronDevScript = packageJson.scripts?.['electron:dev']
  if (electronDevScript === 'node scripts/electron-dev.mjs') {
    print('ok', 'Electron 开发启动脚本已收敛', 'npm run electron:dev 会复用或启动 47821 Vite 预览服务。')
  } else {
    print('warn', 'Electron 开发启动脚本不是推荐路径', `当前 electron:dev = ${electronDevScript ?? '(missing)'}`)
  }
}

function checkNodeRuntime() {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)
  if (major >= 22) {
    print('ok', 'Node.js 版本可用', process.version)
    return
  }
  print('warn', 'Node.js 版本偏低', `当前 ${process.version}；建议使用 Node 22 或更新版本。`)
}

function checkDependencies() {
  const nodeModulesPath = path.join(repoRoot, 'node_modules')
  if (!fs.existsSync(nodeModulesPath)) {
    print('error', '依赖尚未安装', '先运行 npm install。')
    return
  }

  const viteBin = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite')
  const electronPackage = path.join(repoRoot, 'node_modules', 'electron')
  if (!fs.existsSync(viteBin)) {
    print('error', '缺少 Vite 可执行文件', '重新运行 npm install。')
  } else if (!fs.existsSync(electronPackage)) {
    print('error', '缺少 Electron 依赖', '重新运行 npm install。')
  } else {
    print('ok', '前端和 Electron 依赖存在', '可以运行 npm run dev 或 npm run electron:dev。')
  }
}

function checkDeepSeekHint() {
  if (isDeepSeekConfigured()) {
    print('ok', 'DeepSeek 环境变量存在', '应用内仍会优先使用设置页保存的 API Key。')
    return
  }

  print(
    'info',
    'DeepSeek API 可作为云端文本路径',
    'doctor 不读取应用内加密设置；如果你用 DeepSeek，请在模型设置里选择 DeepSeek 并填写 API Key。',
  )
}

console.log('Nexus Doctor')
console.log('-------------')

if (providerMode !== rawProviderMode) {
  print('warn', '未知文本路径参数', `收到 --provider=${rawProviderMode}，已回退到 auto。可用值：auto、ollama、deepseek。`)
}
print('info', '文本路径模式', providerMode === 'auto' ? 'auto：同时提示 Ollama 和 DeepSeek 可用性。' : providerMode)

checkRepository()
checkNodeRuntime()
checkDependencies()
await checkPreviewServer()
await checkOllama()
checkDeepSeekHint()

console.log('-------------')
console.log(`Summary: ${counters.ok} ok, ${counters.warn} warnings, ${counters.error} errors, ${counters.info} info`)

if (counters.error > 0) {
  process.exitCode = 1
}
