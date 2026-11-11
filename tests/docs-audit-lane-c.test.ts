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

test('FEATURES.md describes the five default cards and the 12 Advanced sections', () => {
  const features = readDoc('FEATURES.md')

  assert.match(
    features,
    /five default cards: Look and character, Voice, Memory and privacy, Connection, About/,
  )
  assert.match(features, /Each card has an Advanced section/)
  assert.match(
    features,
    /12 settings sections live there: Model, Desktop, Profile, Diagnostics, History, Letters, Voice, Memory, Background & Phrases, Connection, Proactive, Tools/,
  )
  assert.match(features, /\| Settings Sections \| 12 \|/)
  assert.ok(!features.includes('Connections'))
  assert.ok(!features.includes('8 user-facing entries'))
})

test('ROADMAP.md uses the shipped Live2D default and no longer calls MCP a stub', () => {
  const roadmap = readDoc('docs/ROADMAP.md')

  assert.ok(!roadmap.includes('nexus-mini'))
  assert.ok(!roadmap.includes('MCP host stub'))
  assert.ok(!roadmap.includes("doesn't actually consume MCP servers"))
  assert.match(roadmap, /MCP is already available in chat/)
  assert.match(roadmap, /Settings → Connection/)
})

test('ROADMAP.md describes SHA-256 manifests without claiming GPG signatures', () => {
  const roadmap = readDoc('docs/ROADMAP.md')

  assert.ok(!roadmap.includes('add detached GPG signature'))
  assert.match(roadmap, /GPG signatures are not provided yet/)
})

test('RELEASING.md describes the current unsigned-manual posture without a version cutoff', () => {
  const releasing = readDoc('docs/RELEASING.md')

  assert.ok(!releasing.includes('This exception ends with v0.5.0'))
  assert.ok(!releasing.includes('This exception ends with v0.5.1'))
  assert.ok(!releasing.includes('v0.5.1 and later must publish the signed profile'))
  assert.ok(!releasing.includes('v0.5.2 and later must publish'))
  assert.match(releasing, /currently still ships the unsigned-manual update posture/)
  assert.match(releasing, /update README and RELEASING in the same version/)
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
