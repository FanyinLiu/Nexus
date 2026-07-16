import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  getContentHash,
  minifyBuiltCss,
  minifyCssText,
} from '../scripts/minify-built-css.mjs'

test('CSS output minification preserves authored rule order', () => {
  const output = minifyCssText('.second { color: red; } .first { color: blue; }')
  assert.ok(output.indexOf('.second') < output.indexOf('.first'))
})

test('CSS output minification preserves responsive media queries', () => {
  const output = minifyCssText('@media (width<=719px) { .narrow { display: grid; } }')
  assert.match(output, /@media \(max-width:719px\)/)
  assert.match(output, /\.narrow\{display:grid\}/)
})

test('CSS output hashes are stable and content-sensitive', () => {
  assert.equal(getContentHash('nexus'), getContentHash('nexus'))
  assert.notEqual(getContentHash('nexus'), getContentHash('Nexus'))
  assert.match(getContentHash('nexus'), /^[a-f0-9]{64}$/)
})

test('built CSS is compressed in place with a verified integrity manifest', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nexus-css-build-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const assets = path.join(root, 'assets')
  await mkdir(assets, { recursive: true })
  await writeFile(path.join(assets, 'index.css'), '.a { color: red; }\n.b { color: blue; }\n')

  const [result] = await minifyBuiltCss(root)
  assert.ok(result.bytes < 42)
  assert.equal(result.file, 'assets/index.css')
  const finalCss = await readFile(path.join(assets, 'index.css'), 'utf8')
  assert.equal(result.sha256, getContentHash(finalCss))
  const manifest = JSON.parse(await readFile(path.join(root, 'css-integrity.json'), 'utf8'))
  assert.deepEqual(manifest, { algorithm: 'sha256', assets: [result] })
})

test('built CSS minification fails closed when the build has no CSS assets', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nexus-css-empty-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'assets'), { recursive: true })
  await assert.rejects(() => minifyBuiltCss(root), /No built CSS assets found/)
})
