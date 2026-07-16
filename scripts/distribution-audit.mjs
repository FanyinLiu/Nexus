#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildIpcContractReport, summarizeIpcContractReport } from './ipc-contract-audit.mjs'
import { buildReleaseTrustReport, summarizeReleaseTrustReport } from './release-trust-audit.mjs'
import { buildStorageContractReport } from './storage-contract-audit.mjs'
import { buildHeavyModuleAuditReport } from './heavy-module-audit.mjs'
import { buildModelIntegrityReport } from './model-integrity-audit.mjs'
import { buildCompanionBoundaryReport } from './companion-boundary-audit.mjs'
import { buildArchitectureBoundaryReport } from './architecture-boundary-audit.mjs'
import { buildSourceSizeReport } from './source-size-audit.mjs'
import { buildPerformanceBaselineReport } from './performance-baseline.mjs'
import { buildV04DraftStackReport } from './v04-draft-stack-audit.mjs'
import { buildMessagePrivacyReport } from './message-privacy-audit.mjs'
import { buildDesktopContextPrivacyReport } from './desktop-context-privacy-audit.mjs'
import { buildVaultSecurityReport } from './vault-security-audit.mjs'
import { buildErrorRedactionReport } from './error-redaction-audit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const checks = []

function readText(path) {
  return readFileSync(join(ROOT, path), 'utf8')
}

function readJson(path) {
  return JSON.parse(readText(path))
}

function check(label, fn) {
  checks.push({ label, fn })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function hasScript(pkg, name) {
  return typeof pkg.scripts?.[name] === 'string' && pkg.scripts[name].length > 0
}

const pkg = readJson('package.json')
const ciWorkflow = readText('.github/workflows/ci.yml')
const releaseWorkflow = readText('.github/workflows/release.yml')
const updaterService = readText('electron/services/updaterService.js')
const preload = readText('electron/preload.js')
const releasingDoc = readText('docs/RELEASING.md')
const readme = readText('README.md')
const roadmap = readText('docs/ROADMAP.md')
const upgradePlan = readText('docs/NEXUS_UPGRADE_INTEGRATION_PLAN.md')
const featureInventory = readText('FEATURES.md')
const documentationConsistencyDoc = readText('docs/DOCUMENTATION_CONSISTENCY.md')
const packageStartupOptimizationDoc = readText('docs/PACKAGE_STARTUP_OPTIMIZATION.md')
const localizedReadmes = {
  'docs/README.zh-CN.md': readText('docs/README.zh-CN.md'),
  'docs/README.zh-TW.md': readText('docs/README.zh-TW.md'),
  'docs/README.ja.md': readText('docs/README.ja.md'),
  'docs/README.ko.md': readText('docs/README.ko.md'),
}
const desktopShortcutInstaller = readText('scripts/install-desktop-shortcut.ps1')
const hiddenLauncher = readText('scripts/launch-nexus-hidden.vbs')
const currentVersion = `v${pkg.version}`
const readmeFiles = {
  'README.md': readme,
  ...localizedReadmes,
}

check('desktop app stays private on npm', () => {
  assert(pkg.private === true, 'package.json should remain private until a separate CLI installer exists')
})

check('developer npm scripts cover run, package and release verification', () => {
  for (const name of [
    'electron:dev',
    'doctor',
    'package:mac',
    'package:win',
    'package:linux',
    'package:dir:smoke',
    'package:size:audit',
    'core-path:smoke',
    'core-path:smoke:built',
    'lint',
    'test',
    'build',
    'verify:release',
    'verify:pr',
    'typecheck:electron-security',
    'ipc:audit',
    'storage:audit',
    'heavy:audit',
    'model:integrity:audit',
    'architecture:audit',
    'source-size:audit',
    'performance:baseline',
    'v04:draft-stack:audit',
    'v04:draft-stack:audit:quick',
    'companion-boundary:audit',
    'message-privacy:audit',
    'desktop-context-privacy:audit',
    'vault-security:audit',
    'error-redaction:audit',
    'sqlite:smoke',
    'sqlite:smoke:electron',
    'sqlite:smoke:all',
    'release:trust:audit',
    'release:unsigned:gate',
    'release:signing:readiness',
    'release:signing:gate',
    'release:signing:gate:mac',
    'release:signing:gate:windows',
    'prerelease-check',
    'distribution:audit',
  ]) {
    assert(hasScript(pkg, name), `missing npm script: ${name}`)
  }
})

check('desktop installers are configured for all supported platforms', () => {
  assert(pkg.name === 'nexus', 'package name must stay nexus')
  assert(pkg.build?.productName === 'Nexus', 'build.productName must be Nexus')
  assert(pkg.build?.appId === 'ai.factory.desktoppet', 'build.appId must stay ai.factory.desktoppet')
  assert(pkg.build?.directories?.output === 'release', 'build output should be release/')
  assert(pkg.build?.win?.target?.includes('nsis'), 'Windows NSIS target missing')
  assert(pkg.build?.mac?.target?.includes('dmg'), 'macOS dmg target missing')
  assert(pkg.build?.mac?.target?.includes('zip'), 'macOS zip target missing for updater metadata')
  assert(pkg.build?.linux?.target?.includes('AppImage'), 'Linux AppImage target missing')
  assert(pkg.build?.linux?.target?.includes('deb'), 'Linux deb target missing')
  assert(Array.isArray(pkg.build?.mac?.extraResources) && pkg.build.mac.extraResources.length > 0, 'macOS production extraResources missing')
  assert(Array.isArray(pkg.build?.win?.extraResources) && pkg.build.win.extraResources.length > 0, 'Windows production extraResources missing')
  assert(pkg.build?.electronFuses?.onlyLoadAppFromAsar === true, 'production onlyLoadAppFromAsar fuse must remain enabled')
  assert(pkg.build?.electronFuses?.enableEmbeddedAsarIntegrityValidation === true, 'production ASAR integrity fuse must remain enabled')
})

check('desktop release profile is explicitly unsigned', () => {
  assert(pkg.build?.forceCodeSigning === false, 'build.forceCodeSigning must be false')
  assert(pkg.build?.mac?.identity === '-', "build.mac.identity must be '-'")
  assert(pkg.build?.mac?.hardenedRuntime === false, 'build.mac.hardenedRuntime must be false')
  assert(pkg.build?.mac?.gatekeeperAssess === false, 'build.mac.gatekeeperAssess must be false')
  assert(pkg.build?.mac?.notarize === false, 'build.mac.notarize must be false')
  assert(
    pkg.build?.win?.signAndEditExecutable === true,
    'build.win.signAndEditExecutable must preserve executable metadata; post-package verification proves the result is unsigned',
  )
})

check('GitHub publish target is configured for electron-updater', () => {
  const publish = pkg.build?.publish?.[0]
  assert(publish?.provider === 'github', 'publish.provider must be github')
  assert(publish?.owner === 'FanyinLiu', 'publish.owner must be FanyinLiu')
  assert(publish?.repo === 'Nexus', 'publish.repo must be Nexus')
  assert(pkg.dependencies?.['electron-updater'], 'electron-updater dependency missing')
})

check('release workflow builds and uploads updater metadata', () => {
  assert(releaseWorkflow.includes("tags:\n      - 'v*.*.*'"), 'release workflow must run on version tags')
  assert(releaseWorkflow.includes('workflow_dispatch:'), 'release workflow should support manual retry of draft releases')
  for (const artifact of ['release/latest.yml', 'release/latest-mac.yml', 'release/latest-linux*.yml']) {
    assert(releaseWorkflow.includes(artifact), `release workflow missing ${artifact}`)
  }
})

check('release workflow serializes runs for the same resolved tag', () => {
  assert(
    releaseWorkflow.includes('group: release-${{ github.repository }}-${{ inputs.tag || github.ref_name }}'),
    'release workflow concurrency must be scoped to the repository and requested tag',
  )
  assert(
    releaseWorkflow.includes('cancel-in-progress: false'),
    'an in-flight release must not be canceled by a retry for the same tag',
  )
})

check('release workflow runs the pre-release gate before packaging', () => {
  const resolveTagIndex = releaseWorkflow.indexOf('\n  resolve-tag:')
  const preflightIndex = releaseWorkflow.indexOf('\n  preflight:')
  const ensureReleaseIndex = releaseWorkflow.indexOf('\n  ensure-release:')
  const buildIndex = releaseWorkflow.indexOf('\n  build:')

  assert(resolveTagIndex >= 0, 'release workflow missing resolve-tag job')
  assert(releaseWorkflow.includes('preflight:'), 'release workflow missing preflight job')
  assert(
    resolveTagIndex < preflightIndex && preflightIndex < ensureReleaseIndex && ensureReleaseIndex < buildIndex,
    'release jobs must resolve tag, pass preflight, create/reuse the draft, then build in that order',
  )
  assert(
    releaseWorkflow.includes('needs: [resolve-tag, preflight]'),
    'draft creation must depend on the complete preflight job',
  )
  assert(releaseWorkflow.includes('needs: ensure-release'), 'build job must depend on post-preflight draft creation')
  assert(releaseWorkflow.includes('npm run sqlite:smoke'), 'release workflow must run sqlite:smoke before packaging')
  assert(releaseWorkflow.includes('npm run prerelease-check --'), 'release workflow must run prerelease-check')
  assert(releaseWorkflow.includes('--skip=A --quick'), 'release workflow should use the tag-safe prerelease-check mode')
  assert(releaseWorkflow.includes('xvfb-run -a npm run prerelease-check --'), 'Ubuntu release preflight must run under xvfb-run')
  assert(releaseWorkflow.includes('npm run release:signing:readiness'), 'release workflow should report signing readiness before packaging')
  assert(releaseWorkflow.includes('npm run release:unsigned:gate'), 'release workflow must enforce the explicit unsigned gate')
  assert(!releaseWorkflow.includes('npm run release:signing:gate'), 'signed readiness must not be the current release gate')
  assert(releaseWorkflow.includes('Verify formal identity and unsigned posture before packaging'), 'release workflow must isolate production identity before packaging')

  const resolveAndPreflight = releaseWorkflow.slice(resolveTagIndex, ensureReleaseIndex)
  assert(!resolveAndPreflight.includes('gh release create'), 'tag validation and preflight must not create a draft release')
})

check('release workflow binds the tag to package.json version', () => {
  assert(releaseWorkflow.includes('Validate release tag matches package version'), 'release workflow must validate tag/package version equality')
  assert(releaseWorkflow.includes('PACKAGE_VERSION=$(node -p'), 'release workflow must read package.json version')
  assert(releaseWorkflow.includes('v$PACKAGE_VERSION'), 'release workflow must compare the resolved tag with package version')
  assert(releaseWorkflow.includes('exit 1'), 'tag/package version mismatch must fail closed')
})

check('release workflow binds the tag commit to origin/main and the checkout', () => {
  const publishIndex = releaseWorkflow.indexOf('\n  publish:')
  const publishWorkflow = releaseWorkflow.slice(publishIndex)
  const remoteReadIndex = publishWorkflow.indexOf('git ls-remote --exit-code origin "refs/tags/$TAG" "refs/tags/$TAG^{}"')
  const refetchIndex = publishWorkflow.indexOf('"+refs/tags/$TAG:refs/tags/$TAG"')
  const publishAncestryIndex = publishWorkflow.indexOf('git merge-base --is-ancestor "$EXPECTED_COMMIT" origin/main')
  const publishEditIndex = publishWorkflow.indexOf('gh release edit "$TAG"')

  assert(releaseWorkflow.includes('fetch-depth: 0'), 'release checkouts must have full history')
  assert(releaseWorkflow.includes('git fetch --force origin +refs/heads/main:refs/remotes/origin/main'), 'release workflow must refresh origin/main explicitly')
  assert(releaseWorkflow.includes('git show-ref --verify --quiet "refs/tags/$TAG"'), 'release workflow must require an actual Git tag ref')
  assert(releaseWorkflow.includes('TAG_COMMIT=$(git rev-list -n 1 "refs/tags/$TAG")'), 'release workflow must resolve the tag commit')
  assert(releaseWorkflow.includes('CHECKOUT_COMMIT=$(git rev-parse HEAD)'), 'release workflow must resolve the checked-out commit')
  assert(releaseWorkflow.includes('git merge-base --is-ancestor "$TAG_COMMIT" origin/main'), 'release tag commit must be an ancestor of origin/main')
  assert(releaseWorkflow.includes('if [ "$TAG_COMMIT" != "$CHECKOUT_COMMIT" ]'), 'tag commit and checkout mismatch must fail closed')
  assert(releaseWorkflow.includes('--target "$TAG_COMMIT"'), 'draft release target must use the validated tag commit')
  assert(remoteReadIndex >= 0, 'publish must re-read the remote tag immediately before publication')
  assert(refetchIndex > remoteReadIndex, 'publish must force-refresh the exact remote tag after reading it')
  assert(
    publishWorkflow.includes('[ "$REMOTE_TAG_COMMIT" != "$EXPECTED_COMMIT" ]')
      && publishWorkflow.includes('[ "$FETCHED_TAG_COMMIT" != "$EXPECTED_COMMIT" ]')
      && publishWorkflow.includes('[ "$CHECKOUT_COMMIT" != "$EXPECTED_COMMIT" ]'),
    'publish must bind remote, fetched, and checked-out commits to the validated commit',
  )
  assert(
    publishAncestryIndex > refetchIndex && publishEditIndex > publishAncestryIndex,
    'publish must refresh origin/main and revalidate ancestry before publishing the draft',
  )
})

check('release workflow reuses only an identity-matched draft', () => {
  assert(
    releaseWorkflow.includes('gh api --silent --include "repos/$REPOSITORY/releases/tags/$encoded_tag"')
      && releaseWorkflow.includes('[ "$lookup_exit" -eq 0 ] && [ "$http_status" = "200" ]')
      && releaseWorkflow.includes('elif [ "$http_status" = "404" ]'),
    'draft lookup must distinguish a real 404 from API and authorization failures',
  )
  assert(
    releaseWorkflow.includes('isDraft: .draft, isPrerelease: .prerelease, tagName: .tag_name, targetCommitish: .target_commitish'),
    'draft lookup must request draft, prerelease, tag, and target identity fields',
  )
  assert(releaseWorkflow.includes('EXPECTED_PRERELEASE=true'), 'draft reuse must derive prerelease identity from the tag')
  assert(
    releaseWorkflow.includes('[ "$is_prerelease" != "$EXPECTED_PRERELEASE" ]'),
    'draft reuse must reject a prerelease classification mismatch',
  )
  assert(
    releaseWorkflow.includes('[ "$release_tag" != "$TAG" ]'),
    'draft reuse must reject a tag identity mismatch',
  )
  assert(
    releaseWorkflow.includes('jq -rn --arg value "$target_commitish" \'$value | @uri\'')
      && releaseWorkflow.includes('gh api "repos/$REPOSITORY/commits/$encoded_target" --jq \'.sha\''),
    'targetCommitish must be safely encoded and resolved through the GitHub commits API',
  )
  assert(
    releaseWorkflow.includes('[ "$target_commit" != "$TAG_COMMIT" ]'),
    'draft reuse must bind the resolved targetCommitish to the validated tag commit',
  )
})

check('release workflow builds only after required browser VAD is present', () => {
  const buildIndex = releaseWorkflow.indexOf('\n  build:')
  const publishIndex = releaseWorkflow.indexOf('\n  publish:', buildIndex)
  const buildWorkflow = releaseWorkflow.slice(buildIndex, publishIndex)
  const downloadIndex = buildWorkflow.indexOf('node scripts/download-models.mjs --skip-asr')
  const setupVendorIndex = buildWorkflow.indexOf('node scripts/setup-vendor.mjs')
  const viteIndex = buildWorkflow.indexOf('name: Vite build')
  const vadGateIndex = buildWorkflow.indexOf('name: Verify browser VAD asset in built renderer')
  const packageIndex = buildWorkflow.indexOf('run: ${{ matrix.cmd }}')

  assert(downloadIndex >= 0 && downloadIndex < setupVendorIndex, 'required models must download before deterministic vendor refresh')
  assert(setupVendorIndex < viteIndex, 'browser VAD vendor assets must refresh after cache restore and before Vite copies public assets')
  assert(viteIndex < vadGateIndex && vadGateIndex < packageIndex, 'built browser VAD integrity must pass before packaging')
  assert(buildWorkflow.includes("hashFiles('package-lock.json', 'electron/services/modelDefinitions.js')"), 'model/VAD cache must be invalidated by package-lock changes')
  assert(buildWorkflow.includes('dist/vendor/vad/vad.worklet.bundle.min.js'), 'built browser VAD worklet must be present in the renderer output')
  assert(buildWorkflow.includes('node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js'), 'browser VAD worklet must be compared with its installed dependency source')
  assert(buildWorkflow.includes('workletStat.size !== sourceWorkletStat.size'), 'browser VAD worklet must match the dependency byte size')
  assert(buildWorkflow.includes('workletDigest !== sourceWorkletDigest'), 'browser VAD worklet must match the dependency SHA-256')
  assert(buildWorkflow.includes("MODEL_CATALOG.find((model) => model.id === 'vad')"), 'browser VAD verification must use catalog integrity metadata')
  assert(buildWorkflow.includes('stat.size !== integrity.sizeBytes'), 'browser VAD verification must enforce catalog byte size')
  assert(buildWorkflow.includes("createHash('sha256')"), 'browser VAD verification must compute SHA-256')
  assert(buildWorkflow.includes('modelDigest !== integrity.sha256'), 'browser VAD verification must enforce catalog SHA-256')
})

check('pull requests run the complete policy gate', () => {
  assert(ciWorkflow.includes('npm run verify:pr'), 'CI must run the complete verify:pr policy gate')
  assert(ciWorkflow.includes('npm run knip:production'), 'CI must run the production dead-code audit')
  assert(ciWorkflow.includes('npm run i18n:audit'), 'CI must run the localization contract audit')
  assert(pkg.scripts?.['verify:pr']?.includes('npm run settings:css:audit'), 'verify:pr must run the settings CSS duplication audit')
})

check('trusted IPC boundary has a JavaScript typecheck gate', () => {
  assert(pkg.scripts?.['typecheck:electron-security'], 'trusted IPC boundary typecheck script is missing')
  assert(pkg.scripts?.verify?.includes?.('typecheck:electron-security') || pkg.scripts?.['verify:pr']?.includes('typecheck:electron-security'), 'PR verification must run the trusted IPC typecheck')
  assert(existsSync(join(ROOT, 'electron/ipc/windowCapabilities.js')), 'window capability matrix must exist')
  const validate = readText('electron/ipc/validate.js')
  assert(validate.includes('isWindowChannelAllowed(channel, viewKind)'), 'IPC validation must enforce window capabilities')
})

check('pre-release gate docs include packaged smoke', () => {
  assert(
    releasingDoc.includes('### Stage B — Code quality (8 checks)'),
    'RELEASING should keep Stage B count aligned with prerelease-check',
  )
  assert(
    releasingDoc.includes('`npm run package:dir:smoke`'),
    'RELEASING should document the packaged smoke gate',
  )
  assert(
    releasingDoc.includes('packaged smoke, packaged sustained runtime, coverage, and benchmarks'),
    'RELEASING should document that --quick skips packaged smoke',
  )
  assert(
    releasingDoc.includes('package an unpacked app and launch it with') ||
      releasingDoc.includes('Packaged smoke'),
    'RELEASING should explain what the packaged smoke gate validates',
  )
})

check('packaged smoke enforces app size and forbidden dependency budgets', () => {
  assert(pkg.scripts?.['package:dir:smoke']?.includes('npm run package:size:audit'), 'packaged smoke must run package:size:audit')
  assert(pkg.build?.files?.includes('!node_modules/onnxruntime-node/**'), 'packaging must exclude unused onnxruntime-node payloads')
})

check('core path smoke is release-gated and documented', () => {
  const corePathSmoke = readText('scripts/core-path-smoke.cjs')
  assert(pkg.scripts?.['core-path:smoke']?.includes('core-path:smoke:built'), 'core-path:smoke should build then run the built smoke')
  assert(pkg.scripts?.['core-path:smoke:built'] === 'electron --no-sandbox scripts/core-path-smoke.cjs', 'core-path:smoke:built should run the Electron smoke script with Linux CI sandbox compatibility')
  assert(pkg.scripts?.['verify:release']?.includes('npm run core-path:smoke:built'), 'verify:release should include core path smoke')
  assert(ciWorkflow.includes('npm run core-path:smoke:built'), 'CI should run core path smoke after build')
  assert(ciWorkflow.includes('xvfb-run -a npm run core-path:smoke:built'), 'Linux CI should run core path smoke under xvfb')
  for (const phrase of [
    "view: 'panel'",
    'settings-home-card[data-section="model"]',
    'settings-page[data-section="model"]',
    'settings-model-test-button',
    'nexus.modelSetup.dismissedUntilRestart',
  ]) {
    assert(corePathSmoke.includes(phrase), `core path smoke missing phrase: ${phrase}`)
  }
  assert(releasingDoc.includes('npm run core-path:smoke'), 'RELEASING should document the core path smoke command')
  assert(
    releasingDoc.includes('without real microphone or provider calls'),
    'RELEASING should document that core path smoke avoids microphone/provider dependencies',
  )
})

check('release workflow refuses to mutate published releases', () => {
  assert(!releaseWorkflow.includes('gh release delete'), 'release workflow must not delete published releases')
  assert(!releaseWorkflow.includes('gh release delete-asset'), 'release workflow must not clean up remote release assets')
  assert(!releaseWorkflow.includes('--method DELETE'), 'release workflow must not delete remote assets through the GitHub API')
  assert(!releaseWorkflow.includes('-X DELETE'), 'release workflow must not delete remote assets through the GitHub API')
  assert(
    releaseWorkflow.includes('Published release $TAG already exists') && releaseWorkflow.includes('exit 1'),
    'release workflow should fail when a published tag already exists',
  )
  assert(
    releasingDoc.includes('Never run `gh release edit <tag> --draft=false` manually'),
    'RELEASING must forbid manual publication that bypasses the remote asset closure gate',
  )
  assert(
    releasingDoc.includes('`publish` downloads')
      && releasingDoc.includes('every remote asset into a clean directory'),
    'RELEASING must document the protected remote asset verification step',
  )
})

check('every release platform has SHA256 integrity metadata', () => {
  for (const checksum of ['SHA256SUMS-windows.txt', 'SHA256SUMS-macos.txt', 'SHA256SUMS-linux.txt']) {
    assert(releaseWorkflow.includes(checksum), `release workflow should upload ${checksum}`)
  }
  assert(releaseWorkflow.includes('Generate platform SHA256 checksums'), 'release workflow must generate platform checksum files')
  assert(
    releaseWorkflow.includes('node scripts/release-artifact-audit.mjs --platform ${{ matrix.platform }} --release-dir release --tag "${{ needs.ensure-release.outputs.tag }}" --write-checksums'),
    'release workflow must use the artifact contract to require every platform pattern before writing checksums',
  )
  assert(releaseWorkflow.includes('gh release download "$TAG"'), 'publish must download all remote release assets')
  assert(
    releaseWorkflow.includes('node scripts/release-artifact-audit.mjs --release-dir "$VERIFY_DIR" --tag "$TAG" --verify-all'),
    'publish must verify the complete remote asset set before publication',
  )
  assert(
    releaseWorkflow.indexOf('--verify-all') < releaseWorkflow.indexOf('gh release edit "$TAG"'),
    'remote artifact verification must finish before the draft is published',
  )
  assert(!releaseWorkflow.includes('GPG_PRIVATE_KEY'), 'release workflow must not retain the optional GPG private-key branch')
  assert(!releaseWorkflow.includes('GPG_PASSPHRASE'), 'release workflow must not retain the optional GPG passphrase branch')
  assert(!releaseWorkflow.includes('--detach-sign'), 'release workflow must not generate optional GPG signatures')
})

check('release workflow keeps unsigned packaging explicit and secret-free', () => {
  for (const phrase of [
    "CSC_IDENTITY_AUTO_DISCOVERY: 'false'",
    '--config.forceCodeSigning=false',
    '--config.mac.identity=-',
    '--config.mac.hardenedRuntime=false',
    '--config.mac.gatekeeperAssess=false',
    '--config.mac.notarize=false',
    '--config.win.signAndEditExecutable=true',
    'verify-mac-release.mjs --expect-unsigned',
    'verify-mac-release-containers.mjs --expect-unsigned release',
    'verify-windows-release.mjs --expect-unsigned',
    'node scripts/verify-linux-release.mjs --release-dir release',
    'Reject smoke-named release artifacts',
  ]) {
    assert(releaseWorkflow.includes(phrase), `release workflow missing explicit unsigned contract: ${phrase}`)
  }
  for (const secret of [
    'secrets.APPLE_API_KEY',
    'secrets.APPLE_API_KEY_ID',
    'secrets.APPLE_API_ISSUER',
    'secrets.CSC_LINK',
    'secrets.CSC_KEY_PASSWORD',
    'secrets.WINDOWS_CSC_LINK',
    'secrets.WINDOWS_CSC_KEY_PASSWORD',
  ]) {
    assert(!releaseWorkflow.includes(secret), `release workflow must not wire signing secret: ${secret}`)
  }
  assert(!releaseWorkflow.includes('NEXUS_MAC_AUTO_UPDATE_MODE'), 'unsigned macOS release must stay on manual update downloads')
  assert(!releaseWorkflow.includes('electron-builder.smoke'), 'release workflow must not use the smoke builder config')

  const packageIndex = releaseWorkflow.indexOf('run: ${{ matrix.cmd }}')
  const stagingMacVerifierIndex = releaseWorkflow.indexOf('verify-mac-release.mjs --expect-unsigned release/mac-arm64/Nexus.app')
  const containerMacVerifierIndex = releaseWorkflow.indexOf('verify-mac-release-containers.mjs --expect-unsigned release')
  const checksumIndex = releaseWorkflow.indexOf('release-artifact-audit.mjs --platform')
  assert(
    packageIndex < stagingMacVerifierIndex &&
      stagingMacVerifierIndex < containerMacVerifierIndex &&
      containerMacVerifierIndex < checksumIndex,
    'macOS staging app and DMG/ZIP container verification must run after packaging and before checksums/upload',
  )
})

check('auto-updater is wired through main and preload', () => {
  assert(updaterService.includes('autoUpdater.autoDownload = true'), 'auto-updater should download updates in the background')
  assert(updaterService.includes('autoUpdater.allowDowngrade = false'), 'auto-updater should block downgrades')
  assert(updaterService.includes('!app.isPackaged'), 'auto-updater should explicitly skip dev mode')
  for (const api of ['updaterCheck', 'updaterStatus', 'updaterInstall', 'subscribeUpdaterEvent']) {
    assert(preload.includes(api), `preload missing ${api}`)
  }
})

check('release trust posture is explicit and documented', () => {
  const report = buildReleaseTrustReport(ROOT, { requireUnsigned: 'all' })
  const summary = summarizeReleaseTrustReport(report)
  assert(summary.error === 0, `release trust audit has ${summary.error} error(s); run npm run release:trust:audit`)
})

check('IPC bridge contract baseline is inventoried', () => {
  const report = buildIpcContractReport(ROOT)
  const summary = summarizeIpcContractReport(report)
  assert(summary.errors === 0, `IPC contract audit has ${summary.errors} error(s); run npm run ipc:audit`)
  assert(summary.warnings === 0, `IPC contract audit has ${summary.warnings} warning(s); run npm run ipc:audit`)
  assert(report.counts.preloadInvokeChannels > 0, 'IPC contract audit found no preload invoke channels')
  assert(report.counts.mainHandlerChannels > 0, 'IPC contract audit found no main handler channels')
})

check('renderer localStorage keys have a migration contract', () => {
  const report = buildStorageContractReport(ROOT)
  assert(report.summary.errors === 0, `storage contract audit has ${report.summary.errors} error(s); run npm run storage:audit`)
  assert(report.discoveredKeys === report.contracts, 'storage contract count should match unique discovered browser storage keys')
})

check('heavy renderer modules stay lazy-loaded', () => {
  const report = buildHeavyModuleAuditReport(ROOT)
  assert(report.summary.errors === 0, `heavy module audit has ${report.summary.errors} error(s); run npm run heavy:audit`)
})

check('remote model assets stay pinned and verified', () => {
  const report = buildModelIntegrityReport(ROOT)
  assert(report.summary.errors === 0, `model integrity audit has ${report.summary.errors} error(s); run npm run model:integrity:audit`)
})

check('renderer architecture boundaries do not invert', () => {
  const report = buildArchitectureBoundaryReport(ROOT)
  assert(report.summary.errors === 0, `architecture boundary audit has ${report.summary.errors} error(s); run npm run architecture:audit`)
})

check('source files stay below the large-file budget', () => {
  const report = buildSourceSizeReport(ROOT)
  assert(report.summary.errors === 0, `source size audit has ${report.summary.errors} error(s); run npm run source-size:audit`)
})

check('built assets stay within performance baseline budgets', () => {
  const report = buildPerformanceBaselineReport(ROOT)
  assert(report.summary.errors === 0, `performance baseline has ${report.summary.errors} error(s); run npm run performance:baseline`)
})

check('v0.4 draft stack stays in quick PR-safe state', () => {
  const report = buildV04DraftStackReport(ROOT, { mode: 'quick' })
  assert(report.summary.errors === 0, `v0.4 draft stack audit has ${report.summary.errors} error(s); run npm run v04:draft-stack:audit:quick`)
  assert(report.schemaVersion === 3, 'v0.4 draft stack audit must report schema version 3')
  assert(report.currentStableRelease === currentVersion, `v0.4 draft stack audit must report current stable release ${currentVersion}`)
  assert(report.previousPublicRelease === 'v0.4.1', 'v0.4 draft stack audit must retain v0.4.1 as the previous public release')
  assert(report.releaseState === 'stable', 'v0.4 draft stack audit must report stable release state')
  assert(
    JSON.stringify(report.draftReleases) === JSON.stringify(['v0.4.4', 'v0.4.5']),
    'v0.4 draft stack audit must report the v0.4.4-v0.4.5 draft stack',
  )
})

check('companion boundary is documented and guarded', () => {
  const report = buildCompanionBoundaryReport(ROOT)
  assert(report.summary.errors === 0, `companion boundary audit has ${report.summary.errors} error(s); run npm run companion-boundary:audit`)
})

check('message privacy boundary is guarded', () => {
  const report = buildMessagePrivacyReport(ROOT)
  assert(report.summary.errors === 0, `message privacy audit has ${report.summary.errors} error(s); run npm run message-privacy:audit`)
  assert(report.privacy.staticSourceOnly === true, 'message privacy audit must stay source-only')
  assert(report.privacy.readsMessageContent === false, 'message privacy audit must not read user messages')
})

check('desktop context privacy boundary is guarded', () => {
  const report = buildDesktopContextPrivacyReport(ROOT)
  assert(report.summary.errors === 0, `desktop context privacy audit has ${report.summary.errors} error(s); run npm run desktop-context-privacy:audit`)
  assert(report.privacy.staticSourceOnly === true, 'desktop context privacy audit must stay source-only')
  assert(report.privacy.readsUserData === false, 'desktop context privacy audit must not read user data')
  assert(report.privacy.readsClipboard === false, 'desktop context privacy audit must not read clipboard content')
  assert(report.privacy.readsScreenshots === false, 'desktop context privacy audit must not read screenshots')
  assert(report.privacy.readsActiveWindow === false, 'desktop context privacy audit must not read active-window content')
})

check('vault secret boundary is guarded', () => {
  const report = buildVaultSecurityReport(ROOT)
  assert(report.summary.errors === 0, `vault security audit has ${report.summary.errors} error(s); run npm run vault-security:audit`)
  assert(report.privacy.staticSourceOnly === true, 'vault security audit must stay source-only')
  assert(report.privacy.readsSecrets === false, 'vault security audit must not read secret values')
  assert(report.privacy.rendererReceivesPlaintextSecrets === false, 'renderer must not receive plaintext vault secrets')
})

check('network error redaction boundary is guarded', () => {
  const report = buildErrorRedactionReport(ROOT)
  assert(report.summary.errors === 0, `error redaction audit has ${report.summary.errors} error(s); run npm run error-redaction:audit`)
  assert(report.privacy.staticSourceOnly === true, 'error redaction audit must stay source-only')
  assert(report.privacy.readsSecrets === false, 'error redaction audit must not read secret values')
})

check('source desktop shortcut launches without a terminal window', () => {
  assert(desktopShortcutInstaller.includes('launch-nexus-hidden.vbs'), 'shortcut installer should use the hidden launcher')
  assert(desktopShortcutInstaller.includes("TargetPath = 'wscript.exe'"), 'shortcut target should be wscript.exe when hidden launcher exists')
  assert(hiddenLauncher.includes('powershell.exe -NoProfile -ExecutionPolicy Bypass -File'), 'hidden launcher should call the PowerShell source launcher')
  assert(/shell\.Run\s+command,\s*0,\s*False/i.test(hiddenLauncher), 'hidden launcher should run with window style 0')
})

check('release documentation separates installers from npm developer path', () => {
  assert(/GitHub\s+Releases?/i.test(releasingDoc), 'RELEASING should describe GitHub Releases')
  assert(releasingDoc.includes('npm'), 'RELEASING should document npm as a developer path')
  assert(readme.includes('普通用户'), 'README should explain the normal user install path')
  assert(readme.includes('npm 不是普通用户的安装主路径'), 'README should state npm is not the normal user install path')
  assert(!readme.includes('@fanyin/nexus'), 'README should not mention a future npm installer package')
  assert(!releasingDoc.includes('@fanyin/nexus'), 'RELEASING should not mention a future npm installer package')
  assert(!/\bnpx\s+[@\w-]/.test(readme), 'README should not recommend npx for end-user install')
  assert(!/\bnpx\s+[@\w-]/.test(releasingDoc), 'RELEASING should not recommend npx for end-user install')
  assert(!readme.includes('nexus-desktop'), 'README should not mention the rejected nexus-desktop name')
  assert(!releasingDoc.includes('nexus-desktop'), 'RELEASING should not mention the rejected nexus-desktop name')
})

check('README known limitations are visible before developer setup', () => {
  for (const phrase of [
    '## 已知限制与适用人群',
    '仍在活跃开发',
    '未签名安装包',
    '资源占用',
    'provider 联网',
    '桌面感知',
    '暂停或清理近期陪伴摘要',
    '本地开发',
  ]) {
    assert(readme.includes(phrase), `README missing known limitation phrase: ${phrase}`)
  }

  assert(
    readme.indexOf('## 已知限制与适用人群') < readme.indexOf('## 本地开发'),
    'README known limitations should appear before developer setup',
  )
})

check('README version framing follows package version', () => {
  for (const [file, text] of Object.entries(readmeFiles)) {
    assert(text.includes(currentVersion), `${file} missing current package version ${currentVersion}`)
    assert(!text.includes('v0.2.7'), `${file} should move v0.2.7 history to release notes or GitHub Releases`)
  }

  assert(readme.includes('当前稳定版') && readme.includes('RELEASE-NOTES-v0.4.3.md'), 'README should link the package-aligned current stable v0.4.3 release')
  assert(localizedReadmes['docs/README.zh-CN.md'].includes('当前稳定版') && localizedReadmes['docs/README.zh-CN.md'].includes('RELEASE-NOTES-v0.4.3.md'), 'zh-CN README should link current stable v0.4.3')
  assert(localizedReadmes['docs/README.zh-TW.md'].includes('目前穩定版') && localizedReadmes['docs/README.zh-TW.md'].includes('RELEASE-NOTES-v0.4.3.md'), 'zh-TW README should link current stable v0.4.3')
  assert(localizedReadmes['docs/README.ja.md'].includes('現在の安定版') && localizedReadmes['docs/README.ja.md'].includes('RELEASE-NOTES-v0.4.3.md'), 'ja README should link current stable v0.4.3')
  assert(localizedReadmes['docs/README.ko.md'].includes('현재 안정 버전') && localizedReadmes['docs/README.ko.md'].includes('RELEASE-NOTES-v0.4.3.md'), 'ko README should link current stable v0.4.3')
})

check('documentation consistency workflow is documented', () => {
  for (const phrase of [
    '每月一次',
    'package.json',
    currentVersion,
    'v0.3.6',
    'README.md',
    'docs/README.zh-CN.md',
    'docs/ROADMAP.md',
    'docs/NEXUS_UPGRADE_INTEGRATION_PLAN.md',
    'FEATURES.md',
    'npm run distribution:audit',
  ]) {
    assert(documentationConsistencyDoc.includes(phrase), `documentation consistency doc missing phrase: ${phrase}`)
  }

  assert(roadmap.includes(currentVersion), 'ROADMAP should mention the current package version boundary')
  assert(upgradePlan.includes('每月一次文档回看'), 'upgrade plan should keep the monthly documentation review checkpoint')
  assert(featureInventory.includes('broad capability inventory'), 'FEATURES should keep its capability-inventory framing')
})

check('unsigned install docs cover macOS and Windows trust prompts', () => {
  const requiredByFile = {
    'README.md': [
      '未签名安装提示',
      'GitHub Releases',
      '不要从镜像',
      'Gatekeeper',
      'xattr -dr com.apple.quarantine /Applications/Nexus.app',
      '右键',
      'SmartScreen',
      '详细信息',
      '仍要运行',
    ],
    'docs/README.zh-CN.md': [
      '未签名安装提示',
      'GitHub Releases',
      '不要从镜像',
      'Gatekeeper',
      'xattr -dr com.apple.quarantine /Applications/Nexus.app',
      '右键',
      'SmartScreen',
      '详细信息',
      '仍要运行',
    ],
    'docs/README.zh-TW.md': [
      '未簽署安裝提示',
      'GitHub Releases',
      '不要從鏡像',
      'Gatekeeper',
      'xattr -dr com.apple.quarantine /Applications/Nexus.app',
      '右鍵',
      'SmartScreen',
      '其他資訊',
      '仍要執行',
    ],
    'docs/README.ja.md': [
      '未署名インストール時の注意',
      'GitHub Releases',
      'ミラー',
      'Gatekeeper',
      'xattr -dr com.apple.quarantine /Applications/Nexus.app',
      '右クリック',
      'SmartScreen',
      '詳細情報',
      '実行',
    ],
    'docs/README.ko.md': [
      '미서명 설치 안내',
      'GitHub Releases',
      '미러',
      'Gatekeeper',
      'xattr -dr com.apple.quarantine /Applications/Nexus.app',
      '우클릭',
      'SmartScreen',
      '추가 정보',
      '실행',
    ],
  }

  for (const [file, requiredPhrases] of Object.entries(requiredByFile)) {
    const text = file === 'README.md' ? readme : localizedReadmes[file]
    for (const phrase of requiredPhrases) {
      assert(text.includes(phrase), `${file} missing unsigned install phrase: ${phrase}`)
    }
  }
})

check('package size and startup optimization inventory is documented', () => {
  for (const phrase of [
    'npm run performance:baseline',
    'npm run heavy:audit',
    'npm run source-size:audit',
    'npm run distribution:audit',
    'npm run package:dir:smoke',
    '最大 CSS chunk',
    'TS/JS/CSS',
    '明确临时预算',
    'ort-wasm-simd-threaded.jsep.wasm',
    '@huggingface/transformers',
    'tesseract.js',
    'Live2D',
    'sherpa-models',
    'Silero VAD',
    'download-models.mjs --skip-asr',
    '首次运行下载',
    '可选模型不进安装包',
  ]) {
    assert(packageStartupOptimizationDoc.includes(phrase), `package startup optimization doc missing phrase: ${phrase}`)
  }

  for (const scriptName of ['prepackage:win', 'prepackage:win:signed', 'prepackage:mac', 'prepackage:linux']) {
    assert(
      pkg.scripts?.[scriptName]?.includes('download-models.mjs --skip-asr'),
      `${scriptName} should keep optional voice models out of the default package path`,
    )
  }
})

let failed = 0

console.log('Distribution audit')

for (const item of checks) {
  process.stdout.write(`- ${item.label} ... `)
  try {
    item.fn()
    console.log('OK')
  } catch (error) {
    failed += 1
    console.log('FAIL')
    console.log(`  ${error.message}`)
  }
}

if (failed > 0) {
  console.error(`\n${failed} distribution check${failed === 1 ? '' : 's'} failed.`)
  process.exit(1)
}

console.log('\nAll distribution checks passed.')
