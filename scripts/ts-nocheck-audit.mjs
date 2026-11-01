#!/usr/bin/env node

// Baseline gate for main-process JavaScript opt-outs. Every electron/**/*.js
// file is type-checked by tsconfig.electron.json; a file may only escape that
// check through an explicit `// @ts-nocheck` recorded here. The baseline must
// match the actual opt-outs exactly: a new opt-out (a file opting out without
// an entry) fails, and a stale entry (an entry whose file no longer opts out)
// fails too, with the exact entries to remove and the resulting count.
//
// Both directions are enforced, so fixing a file and removing its entry belong
// to the same change; the list is the measured debt, never a parking lot.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSummary, isInvokedAsScript, walkFiles } from './lib/audit-framework.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ELECTRON_ROOT = 'electron'
const DIRECTIVE = '// @ts-nocheck'

// Sorted so diffs stay reviewable. Never add an entry without fixing the cause
// first: this list is the measured debt, not a place to park new errors.
export const TS_NOCHECK_BASELINE = [
  'electron/audioPostprocess.js',
  'electron/companionPresenceTracker.js',
  'electron/crashRecovery.js',
  'electron/integrationRuntime.js',
  'electron/ipcRegistry.js',
  'electron/launchOnStartup.js',
  'electron/localServiceProbe.js',
  'electron/lyricsSearch.js',
  'electron/main.js',
  'electron/mainMessages.js',
  'electron/mediaSessionRuntime.js',
  'electron/net.js',
  'electron/netHelpers.js',
  'electron/panelWindowController.js',
  'electron/petLocomotion.js',
  'electron/petWindowInstances.js',
  'electron/platformProfile.js',
  'electron/rendererServer.js',
  'electron/runtimeLogSanitizer.js',
  'electron/searchContentExtract.js',
  'electron/services/characterCardMapper.js',
  'electron/services/chatConnectionProof.js',
  'electron/services/desktopContextPolicy.js',
  'electron/services/desktopContextService.js',
  'electron/services/desktopPresence.js',
  'electron/services/discordGateway.js',
  'electron/services/edgeTts.js',
  'electron/services/externalActionPolicy.js',
  'electron/services/externalActionPolicyCore.js',
  'electron/services/externalOpenConfirmation.js',
  'electron/services/factorioRcon.js',
  'electron/services/hardwareProbe.js',
  'electron/services/jsonFileStore.js',
  'electron/services/linuxPointer.js',
  'electron/services/live2dModelCompatibility.js',
  'electron/services/live2dModelDiscoveryService.js',
  'electron/services/localDataChatMigration.js',
  'electron/services/localDataChatStore.js',
  'electron/services/localDataCompanionMigration.js',
  'electron/services/localDataMemoryMigration.js',
  'electron/services/localDataMemoryStore.js',
  'electron/services/localTts.js',
  'electron/services/longTermMemoryFileStore.js',
  'electron/services/macNotificationWatcher.js',
  'electron/services/macPermissions.js',
  'electron/services/mcpApprovals.js',
  'electron/services/mcpHost.js',
  'electron/services/mcpHostUtils.js',
  'electron/services/memoryFlushAckGate.js',
  'electron/services/memoryVectorStore.js',
  'electron/services/minecraftGateway.js',
  'electron/services/modelDownloadSecurity.js',
  'electron/services/modelDownloader.js',
  'electron/services/modelManager.js',
  'electron/services/modelPaths.js',
  'electron/services/modelSetupRequestGate.js',
  'electron/services/notificationBridge.js',
  'electron/services/notificationBridgeUtils.js',
  'electron/services/ollamaEmbed.js',
  'electron/services/personaLoader.js',
  'electron/services/personaProfileLoader.js',
  'electron/services/petModelPaths.js',
  'electron/services/petModelService.js',
  'electron/services/petModelUrlBuilders.js',
  'electron/services/petPrefsStore.js',
  'electron/services/pluginHost.js',
  'electron/services/pluginMessageBus.js',
  'electron/services/presenceInput.js',
  'electron/services/pythonRuntime.js',
  'electron/services/qwen3CportService.js',
  'electron/services/senseVoiceMigration.js',
  'electron/services/sidecarLog.js',
  'electron/services/skillStore.js',
  'electron/services/speechConnectionProof.js',
  'electron/services/speechGainStage.js',
  'electron/services/sttService.js',
  'electron/services/telegramGateway.js',
  'electron/services/tencentAsr.js',
  'electron/services/ttsHelpers.js',
  'electron/services/ttsProviders.js',
  'electron/services/ttsService.js',
  'electron/services/ttsVolcengine.js',
  'electron/services/updateInstallPrep.js',
  'electron/services/updatePolicy.js',
  'electron/services/updaterService.js',
  'electron/services/urlSafety.js',
  'electron/services/vaultRefs.js',
  'electron/services/voiceSidecarHost.js',
  'electron/services/voiceSidecarService.js',
  'electron/services/vtsBridge.js',
  'electron/services/windowBoundsStore.js',
  'electron/services/windowsPermissions.js',
  'electron/services/wsolaStretcher.js',
  'electron/services/xaiSpeech.js',
  'electron/settingsReturnFocus.js',
  'electron/sherpaKws.js',
  'electron/sherpaParaformer.js',
  'electron/sherpaSenseVoice.js',
  'electron/sherpaVad.js',
  'electron/smartTurn.js',
  'electron/smartTurnEngine.js',
  'electron/textNormalize.js',
  'electron/tools/toolRegistry.js',
  'electron/tools/toolRegistryUtils.js',
  'electron/tools/weatherLocalization.js',
  'electron/tools/weatherTool.js',
  'electron/tools/webSearch.js',
  'electron/ttsStreamService.js',
  'electron/webSearchHelpers.js',
  'electron/webSearchProviderRunners.js',
  'electron/webSearchRuntime.js',
  'electron/webSearchSignals.js',
  'electron/windowAssets.js',
  'electron/windowCreation.js',
  'electron/windowManager.js',
  'electron/windowManagerHelpers.js',
  'electron/windowNavigation.js',
  'electron/windowRuntimeState.js',
  'electron/windowStateSanitizers.js',
]

/**
 * True when a source file opts out with a leading `// @ts-nocheck` comment.
 * Only the leading comment block counts, matching how TypeScript reads the
 * directive (a shebang line may precede it).
 * @param {string} source
 * @returns {boolean}
 */
export function hasTsNocheckDirective(source) {
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/)
  let index = lines[0]?.startsWith('#!') ? 1 : 0
  for (; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) continue
    if (line.startsWith(DIRECTIVE)) return true
    if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue
    return false
  }
  return false
}

/**
 * Compare the electron files that currently carry `// @ts-nocheck` against the
 * hardcoded baseline. Passing requires an exact match: an opt-out missing from
 * the baseline and a baseline entry whose file no longer opts out both fail,
 * each with its own error list.
 * @param {string} [root]
 * @param {{ baseline?: readonly string[] }} [options]
 * @returns {object}
 */
export function buildTsNocheckReport(root = ROOT, { baseline = TS_NOCHECK_BASELINE } = {}) {
  const files = walkFiles(root, ELECTRON_ROOT, (file) => file.endsWith('.js')).sort()
  const currentFiles = files.filter((file) => hasTsNocheckDirective(readFileSync(join(root, file), 'utf8')))
  const baselineFiles = [...baseline].sort()
  const baselineSet = new Set(baselineFiles)
  const currentSet = new Set(currentFiles)

  const unexpectedOptOuts = currentFiles.filter((file) => !baselineSet.has(file))
  const staleBaselineEntries = baselineFiles.filter((file) => !currentSet.has(file))
  const baselineExceeded = currentFiles.length > baselineFiles.length
    ? [{ current: currentFiles.length, baseline: baselineFiles.length }]
    : []

  const errors = { unexpectedOptOuts, baselineExceeded, staleBaselineEntries }

  return {
    checkedFiles: files.length,
    baseline: {
      count: baselineFiles.length,
      files: baselineFiles,
    },
    current: {
      count: currentFiles.length,
      files: currentFiles,
    },
    unexpectedOptOuts,
    staleBaselineEntries,
    errors,
    summary: {
      ...buildSummary(errors),
      checkedFiles: files.length,
      baselineCount: baselineFiles.length,
      currentCount: currentFiles.length,
    },
    privacy: {
      readsUserStorage: false,
      staticSourceOnly: true,
    },
  }
}

/**
 * @param {ReturnType<typeof buildTsNocheckReport>} report
 * @returns {string}
 */
function formatHumanReport(report) {
  const lines = ['TypeScript opt-out audit (electron/**/*.js)']
  lines.push(`- checked files: ${report.checkedFiles}`)
  lines.push(`- baseline opt-outs: ${report.baseline.count}`)
  lines.push(`- current opt-outs: ${report.current.count}`)
  lines.push('')
  for (const [name, items] of Object.entries(report.errors)) {
    lines.push(`ERROR ${name}: ${items.length}`)
    if (name === 'unexpectedOptOuts' && items.length) {
      lines.push(`  ${items.slice(0, 8).join(', ')}`)
    }
    if (name === 'baselineExceeded' && items.length) {
      lines.push(`  current=${items[0].current} baseline=${items[0].baseline}`)
    }
    if (name === 'staleBaselineEntries' && items.length) {
      const target = report.baseline.count - items.length
      const noun = items.length === 1 ? 'entry' : 'entries'
      lines.push(
        `  remove ${items.length} stale ${noun} from TS_NOCHECK_BASELINE so the baseline drops to ${target}: ${items.slice(0, 8).join(', ')}`,
      )
    }
  }
  lines.push('')
  lines.push(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  return lines.join('\n')
}

function main(argv) {
  const report = buildTsNocheckReport(ROOT)
  const json = argv.includes('--json') || argv.includes('--format=json')
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatHumanReport(report)}\n`)
  if (!report.summary.ok) process.exit(1)
}

if (isInvokedAsScript(import.meta.url)) {
  main(process.argv.slice(2))
}
