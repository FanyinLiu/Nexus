// uiohook-napi ships N-API binaries as uiohook-napi.node. @electron/rebuild
// only treats a prebuildify artifact named node.napi[.armv8].node as already
// built; otherwise it compiles libuiohook, which CI images do not have
// headers for. Alias the shipped binary so packaging keeps the prebuild.
// Missing the module is the fail-safe path: the app still starts.

import { copyFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const prebuilds = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'uiohook-napi', 'prebuilds')

if (!existsSync(prebuilds)) {
  process.exit(0)
}

for (const dir of readdirSync(prebuilds, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue
  const from = join(prebuilds, dir.name, 'uiohook-napi.node')
  if (!existsSync(from)) continue
  const arch = dir.name.split('-')[1] ?? ''
  const alias = arch === 'arm64'
    ? 'node.napi.armv8.node'
    : arch === 'arm'
      ? 'node.napi.armv7.node'
      : 'node.napi.node'
  const to = join(prebuilds, dir.name, alias)
  if (!existsSync(to)) copyFileSync(from, to)
}
