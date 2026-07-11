/**
 * download-models.mjs
 *
 * Cross-platform CLI wrapper around the shared model catalog + downloader
 * used at runtime (electron/services/modelDefinitions.js + modelDownloader.js).
 * Works on Windows, macOS, and Linux. No git / LFS / auth required.
 *
 * Output layout (matches Windows extraResources expectations):
 *   sherpa-models/<dirName>/...         archive & files models
 *   public/vendor/vad/silero_vad_v5.onnx standalone VAD
 *
 * Usage:
 *   node scripts/download-models.mjs              # download all
 *   node scripts/download-models.mjs --skip-asr   # skip non-required models
 */

import { existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MODEL_CATALOG } from '../electron/services/modelDefinitions.js'
import {
  downloadModel,
  checkModelPresence,
  canReachHuggingFace,
} from '../electron/services/modelDownloader.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const modelsDir = join(root, 'sherpa-models')
const standaloneDir = join(root, 'public', 'vendor', 'vad')

const skipAsr = process.argv.includes('--skip-asr')

function createProgressPrinter() {
  let lastPercent = -1
  let hasLine = false
  let lastFileName = null

  return (payload) => {
    if (payload.phase === 'downloading') {
      if (payload.fileName && payload.fileName !== lastFileName) {
        if (hasLine) { process.stdout.write('\n'); hasLine = false }
        const fileIdx = payload.fileIndex && payload.totalFiles
          ? ` [${payload.fileIndex}/${payload.totalFiles}]`
          : ''
        console.log(`    ↓ ${payload.fileName}${fileIdx}`)
        lastFileName = payload.fileName
        lastPercent = -1
      }
      if (payload.total > 0) {
        const percent = Math.floor((payload.downloaded / payload.total) * 100)
        if (percent >= lastPercent + 10) {
          lastPercent = percent
          hasLine = true
          process.stdout.write(
            `\r      ${percent}% (${(payload.downloaded / 1048576).toFixed(1)} MB)`,
          )
        }
      }
    } else if (payload.phase === 'done' || payload.phase === 'error') {
      if (hasLine) { process.stdout.write('\n'); hasLine = false }
      lastFileName = null
      lastPercent = -1
    }
  }
}

async function main() {
  console.log()
  console.log('============================================')
  console.log('  Nexus 语音模型下载')
  console.log('============================================')
  console.log()

  console.log('[检测] 网络环境...')
  const hf = await canReachHuggingFace()
  console.log(hf
    ? '[检测] HuggingFace 可访问，优先使用 HuggingFace'
    : '[检测] HuggingFace 不可访问，优先使用 ModelScope 国内镜像')
  console.log()

  mkdirSync(modelsDir, { recursive: true })
  mkdirSync(standaloneDir, { recursive: true })

  let downloaded = 0
  let skipped = 0
  let failed = 0

  for (const model of MODEL_CATALOG) {
    console.log(`[${model.label}] (${model.sizeLabel})`)

    const rootsForCheck = model.kind === 'standalone'
      ? [standaloneDir]
      : [modelsDir]
    const presence = checkModelPresence(model, rootsForCheck)
    if (presence.present && presence.verified) {
      console.log('  ✓ 已存在，跳过')
      skipped++
      console.log()
      continue
    }
    if (presence.present) console.log('  ! 发现旧版未校验模型，将重新下载并验证')

    if (skipAsr && !model.required) {
      console.log('  ⊘ 使用了 --skip-asr，跳过可选模型')
      skipped++
      console.log()
      continue
    }

    console.log('  ↓ 开始下载...')
    try {
      await downloadModel(model, {
        modelsRoot: modelsDir,
        standaloneRoot: standaloneDir,
        onProgress: createProgressPrinter(),
      })
      console.log('  ✓ 下载成功')
      downloaded++
    } catch (err) {
      console.warn(`  ✗ 下载失败：${err.message}，该功能将不可用`)
      if (model.required) failed++
    }
    console.log()
  }

  console.log('============================================')
  console.log(`  完成: ${downloaded} 下载, ${skipped} 跳过, ${failed} 失败`)
  console.log('============================================')
  console.log()

  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error('脚本错误:', err)
  process.exit(1)
})
