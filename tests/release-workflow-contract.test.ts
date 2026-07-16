import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')

function jobBody(jobName: string, nextJobName?: string) {
  const start = workflow.indexOf(`\n  ${jobName}:`)
  assert.ok(start >= 0, `missing ${jobName} job`)
  const end = nextJobName ? workflow.indexOf(`\n  ${nextJobName}:`, start + 1) : workflow.length
  assert.ok(end > start, `missing boundary after ${jobName} job`)
  return workflow.slice(start, end)
}

test('release runs for the same tag are serialized without canceling an in-flight build', () => {
  assert.match(workflow, /concurrency:\n {2}group: release-\$\{\{ github\.repository \}\}-\$\{\{ inputs\.tag \|\| github\.ref_name \}\}/)
  assert.match(workflow, /concurrency:\n(?:.*\n){1,3} {2}cancel-in-progress: false/)
})

test('release draft mutation starts only after the complete preflight', () => {
  const resolveTag = jobBody('resolve-tag', 'preflight')
  const preflight = jobBody('preflight', 'ensure-release')
  const ensureRelease = jobBody('ensure-release', 'build')

  assert.doesNotMatch(resolveTag, /gh release (?:create|edit|delete)/)
  assert.doesNotMatch(preflight, /gh release (?:create|edit|delete)/)
  assert.match(ensureRelease, /needs: \[resolve-tag, preflight\]/)
  assert.match(ensureRelease, /gh release create "\$TAG"/)
  assert.match(ensureRelease, /Published release \$TAG already exists/)
  assert.doesNotMatch(ensureRelease, /gh release delete/)
})

test('an existing draft must match the tag prerelease and resolved commit identity', () => {
  const ensureRelease = jobBody('ensure-release', 'build')

  assert.match(ensureRelease, /gh api --silent --include "repos\/\$REPOSITORY\/releases\/tags\/\$encoded_tag"/)
  assert.match(ensureRelease, /"\$lookup_exit" -eq 0.*"\$http_status" = "200"/)
  assert.match(ensureRelease, /elif \[ "\$http_status" = "404" \]/)
  assert.match(ensureRelease, /isDraft: \.draft, isPrerelease: \.prerelease, tagName: \.tag_name, targetCommitish: \.target_commitish/)
  assert.match(ensureRelease, /EXPECTED_PRERELEASE=true/)
  assert.match(ensureRelease, /"\$is_prerelease" != "\$EXPECTED_PRERELEASE"/)
  assert.match(ensureRelease, /"\$release_tag" != "\$TAG"/)
  assert.match(ensureRelease, /jq -rn --arg value "\$target_commitish" '\$value \| @uri'/)
  assert.match(ensureRelease, /gh api "repos\/\$REPOSITORY\/commits\/\$encoded_target" --jq '\.sha'/)
  assert.match(ensureRelease, /"\$target_commit" != "\$TAG_COMMIT"/)
  assert.match(ensureRelease, /--target "\$TAG_COMMIT"/)
})

test('release tag provenance is tied to a full-history checkout and origin/main', () => {
  const resolveTag = jobBody('resolve-tag', 'preflight')
  const preflight = jobBody('preflight', 'ensure-release')
  const publish = jobBody('publish')

  assert.match(resolveTag, /fetch-depth: 0/)
  assert.match(resolveTag, /git show-ref --verify --quiet "refs\/tags\/\$TAG"/)
  assert.match(resolveTag, /TAG_COMMIT=\$\(git rev-list -n 1 "refs\/tags\/\$TAG"\)/)
  assert.match(resolveTag, /CHECKOUT_COMMIT=\$\(git rev-parse HEAD\)/)
  assert.match(resolveTag, /if \[ "\$TAG_COMMIT" != "\$CHECKOUT_COMMIT" \]/)
  assert.match(resolveTag, /git merge-base --is-ancestor "\$TAG_COMMIT" origin\/main/)
  assert.match(preflight, /git merge-base --is-ancestor "\$EXPECTED_COMMIT" origin\/main/)
  assert.match(preflight, /xvfb-run -a npm run prerelease-check -- "\$TAG" --skip=A --quick/)

  const editIndex = publish.indexOf('gh release edit "$TAG"')
  const remoteReadIndex = publish.indexOf('git ls-remote --exit-code origin "refs/tags/$TAG" "refs/tags/$TAG^{}"')
  const refetchIndex = publish.indexOf('"+refs/tags/$TAG:refs/tags/$TAG"')
  const ancestryIndex = publish.indexOf('git merge-base --is-ancestor "$EXPECTED_COMMIT" origin/main')
  assert.ok(remoteReadIndex >= 0 && remoteReadIndex < refetchIndex)
  assert.ok(refetchIndex < ancestryIndex && ancestryIndex < editIndex)
  assert.match(publish, /"\$REMOTE_TAG_COMMIT" != "\$EXPECTED_COMMIT"/)
  assert.match(publish, /"\$FETCHED_TAG_COMMIT" != "\$EXPECTED_COMMIT"/)
  assert.match(publish, /"\$CHECKOUT_COMMIT" != "\$EXPECTED_COMMIT"/)
})

test('release artifacts are contract-checked locally and again after remote download', () => {
  const build = jobBody('build', 'publish')
  const publish = jobBody('publish')
  const setupNodeIndex = publish.indexOf('uses: actions/setup-node@v4')
  const npmCiIndex = publish.indexOf('run: npm ci --ignore-scripts')
  const remoteVerifyIndex = publish.indexOf('release-artifact-audit.mjs --release-dir "$VERIFY_DIR"')
  const finalAncestryIndex = publish.indexOf('git merge-base --is-ancestor "$EXPECTED_COMMIT" origin/main')
  const publishIndex = publish.indexOf('gh release edit "$TAG"')

  assert.match(
    build,
    /node scripts\/release-artifact-audit\.mjs --platform \$\{\{ matrix\.platform \}\} --release-dir release --tag "\$\{\{ needs\.ensure-release\.outputs\.tag \}\}" --write-checksums/,
  )
  assert.match(publish, /gh release download "\$TAG"[^\n]*--dir "\$VERIFY_DIR"/)
  assert.match(publish, /release-artifact-audit\.mjs --release-dir "\$VERIFY_DIR" --tag "\$TAG" --verify-all/)
  assert.ok(setupNodeIndex >= 0 && setupNodeIndex < npmCiIndex)
  assert.ok(npmCiIndex < remoteVerifyIndex)
  assert.doesNotMatch(publish, /run: npm ci\s*$/m)
  assert.ok(finalAncestryIndex < remoteVerifyIndex && remoteVerifyIndex < publishIndex)
  assert.match(publish, /Keeping this in the same shell step closes the/)
  assert.doesNotMatch(workflow, /gh release delete(?:-asset)?/)
  assert.doesNotMatch(workflow, /(?:--method|-X) DELETE/)
})

test('required browser VAD is downloaded before Vite and integrity-checked before packaging', () => {
  const build = jobBody('build', 'publish')
  const downloadIndex = build.indexOf('node scripts/download-models.mjs --skip-asr')
  const setupVendorIndex = build.indexOf('node scripts/setup-vendor.mjs')
  const viteIndex = build.indexOf('name: Vite build')
  const vadGateIndex = build.indexOf('name: Verify browser VAD asset in built renderer')
  const packageIndex = build.indexOf('run: ${{ matrix.cmd }}')

  assert.ok(downloadIndex >= 0 && downloadIndex < setupVendorIndex)
  assert.ok(setupVendorIndex < viteIndex)
  assert.ok(viteIndex < vadGateIndex && vadGateIndex < packageIndex)
  assert.match(build, /sherpa-models-skip-asr-\$\{\{ hashFiles\('package-lock\.json', 'electron\/services\/modelDefinitions\.js'\) \}\}/)
  assert.match(build, /dist\/vendor\/vad\/silero_vad_v5\.onnx/)
  assert.match(build, /dist\/vendor\/vad\/vad\.worklet\.bundle\.min\.js/)
  assert.match(build, /node_modules\/@ricky0123\/vad-web\/dist\/vad\.worklet\.bundle\.min\.js/)
  assert.match(build, /workletStat\.size !== sourceWorkletStat\.size/)
  assert.match(build, /workletDigest !== sourceWorkletDigest/)
  assert.match(build, /MODEL_CATALOG\.find\(\(model\) => model\.id === 'vad'\)/)
  assert.match(build, /stat\.size !== integrity\.sizeBytes/)
  assert.match(build, /createHash\('sha256'\)/)
  assert.match(build, /modelDigest !== integrity\.sha256/)
})

test('Windows keeps metadata editing but verifies that formal artifacts remain unsigned', () => {
  const build = jobBody('build', 'publish')

  assert.match(build, /electron-builder --win nsis --x64[^\n]*--config\.win\.signAndEditExecutable=true/)
  assert.doesNotMatch(build, /--config\.win\.signAndEditExecutable=false/)
  assert.match(build, /verify-windows-release\.mjs --expect-unsigned/)
})

test('macOS verifies the staging app and both release containers before checksums', () => {
  const build = jobBody('build', 'publish')
  const packageIndex = build.indexOf('run: ${{ matrix.cmd }}')
  const stagingVerifierIndex = build.indexOf('verify-mac-release.mjs --expect-unsigned release/mac-arm64/Nexus.app')
  const containerVerifierIndex = build.indexOf('verify-mac-release-containers.mjs --expect-unsigned release')
  const checksumIndex = build.indexOf('release-artifact-audit.mjs --platform')

  assert.ok(packageIndex >= 0)
  assert.ok(packageIndex < stagingVerifierIndex)
  assert.ok(stagingVerifierIndex < containerVerifierIndex)
  assert.ok(containerVerifierIndex < checksumIndex)
})
