import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

function readDoc(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

test('FEATURES.md drops unimplemented voice, deleted UI, and unshipped auto-skill claims', () => {
  const features = readDoc('FEATURES.md')

  assert.ok(!features.includes('OpenAI Realtime API'))
  assert.ok(!features.includes('Provider Choice Grid'))
  if (features.includes('Auto Skills')) {
    assert.match(features, /Auto Skills[\s\S]{0,400}未对用户开放/)
  }
})

test('FEATURES.md reports the current 12 settings entries and section count', () => {
  const features = readDoc('FEATURES.md')

  assert.match(
    features,
    /12 user-facing entries: Model, Desktop, Profile, Diagnostics, History, Letters, Voice, Memory, Background & Phrases, Connections, Proactive, Tools/,
  )
  assert.match(features, /\| Settings Sections \| 12 \|/)
  assert.ok(!features.includes('8 user-facing entries'))
})

test('ROADMAP.md uses the shipped Live2D default and no longer calls MCP a stub', () => {
  const roadmap = readDoc('docs/ROADMAP.md')

  assert.ok(!roadmap.includes('nexus-mini'))
  assert.ok(!roadmap.includes('MCP host stub'))
  assert.ok(!roadmap.includes("doesn't actually consume MCP servers"))
  assert.match(roadmap, /MCP is already available in chat/)
  assert.match(roadmap, /Settings → Connections/)
})

test('ROADMAP.md describes SHA-256 manifests without claiming GPG signatures', () => {
  const roadmap = readDoc('docs/ROADMAP.md')

  assert.ok(!roadmap.includes('add detached GPG signature'))
  assert.match(roadmap, /GPG signatures are not provided yet/)
})

test('RELEASING.md keeps the unsigned-manual exception valid for v0.5.1', () => {
  const releasing = readDoc('docs/RELEASING.md')

  assert.ok(!releasing.includes('This exception ends with v0.5.0'))
  assert.ok(!releasing.includes('v0.5.1 and later must publish the signed profile'))
  assert.match(releasing, /v0.5.1 continues the same unsigned-manual exception/)
})

test('README.md localizes the unsigned install headings and keeps the no-auto-update fact', () => {
  const readme = readDoc('README.md')

  assert.ok(!readme.includes('macOS unsigned auto-update limitation'))
  assert.ok(!readme.includes('Windows unsigned installer limitation'))
  assert.match(readme, /#### macOS 未签名自动更新限制/)
  assert.match(readme, /#### Windows 未签名安装器限制/)
  assert.match(readme, /^### 自动更新说明$/m)
  assert.ok(!readme.includes('### 自动更新说明（Windows / Linux）'))
  assert.match(readme, /目前 Windows 和 Linux 没有自动更新/)
})
