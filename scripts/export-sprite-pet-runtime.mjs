#!/usr/bin/env node

import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import path from 'node:path'
import {
  SPRITE_PET_ATLAS_HEIGHT,
  SPRITE_PET_ATLAS_WIDTH,
  SPRITE_PET_CELL_HEIGHT,
  SPRITE_PET_CELL_WIDTH,
  SPRITE_PET_COLUMNS,
  SPRITE_PET_ROW_CONTRACT,
  SPRITE_PET_ROWS,
  assertNotPrivateCodexPetSource,
  readSpritePetPackage,
} from '../electron/services/spritePetPackage.js'

function printUsage() {
  console.error([
    'Usage: npm run pet:export-runtime -- [options]',
    '',
    'Options:',
    '  --output-dir <dir>       Output folder. Default: output/sprite-pet-runtime',
    '  --package <pet>          Optional validated pet.json or package folder to copy into the demo.',
    '  --force                  Replace an existing output folder.',
  ].join('\n'))
}

function parseArgs(argv) {
  const options = {
    outputDir: path.resolve(process.cwd(), 'output', 'sprite-pet-runtime'),
    packagePath: '',
    force: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }

    if (arg === '--force') {
      options.force = true
      continue
    }

    if (arg === '--output-dir' || arg === '--package') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error(`${arg} requires a value.`)
      }
      if (arg === '--output-dir') options.outputDir = path.resolve(process.cwd(), value)
      if (arg === '--package') options.packagePath = value
      index += 1
      continue
    }

    throw new Error(`Unknown option: ${arg}`)
  }

  return options
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function resolveManifestPath(inputPath) {
  const targetPath = path.resolve(process.cwd(), inputPath)
  const stats = await fs.stat(targetPath)
  return stats.isDirectory() ? path.join(targetPath, 'pet.json') : targetPath
}

function slugifySpritePetId(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/[\\/]+/g, '-')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()

  return normalized || 'sprite-pet'
}

function buildContract() {
  return {
    name: 'Codex/Nexus 8x9 sprite atlas contract',
    sourcePolicy: 'clean-room implementation; use original, licensed, or user-provided art',
    privateCodexCodeOrAssetsCopied: false,
    atlas: {
      width: SPRITE_PET_ATLAS_WIDTH,
      height: SPRITE_PET_ATLAS_HEIGHT,
      columns: SPRITE_PET_COLUMNS,
      rows: SPRITE_PET_ROWS,
      cellWidth: SPRITE_PET_CELL_WIDTH,
      cellHeight: SPRITE_PET_CELL_HEIGHT,
    },
    rows: SPRITE_PET_ROW_CONTRACT.map((rowContract) => ({
      row: rowContract.row,
      state: rowContract.state,
      frameCount: rowContract.frameCount,
      transparentUnusedCells: SPRITE_PET_COLUMNS - rowContract.frameCount,
      durationsMs: rowContract.durationsMs,
    })),
    alphaPolicy: 'PNG unused cells must be transparent; WebP must expose alpha',
  }
}

async function hashFile(filePath) {
  const buffer = await fs.readFile(filePath)
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

async function collectExportFiles(directoryPath, rootPath = directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name)
    const relativePath = path.relative(rootPath, entryPath).replaceAll(path.sep, '/')

    if (relativePath === 'export-manifest.json') {
      continue
    }

    if (entry.isDirectory()) {
      files.push(...(await collectExportFiles(entryPath, rootPath)))
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    const stats = await fs.stat(entryPath)
    files.push({
      path: relativePath,
      bytes: stats.size,
      sha256: await hashFile(entryPath),
    })
  }

  return files.sort((left, right) => left.path.localeCompare(right.path))
}

function buildExportManifest({ contract, demoPackage, files }) {
  return {
    schemaVersion: 1,
    name: 'Nexus sprite pet runtime export',
    generatedBy: 'scripts/export-sprite-pet-runtime.mjs',
    sourcePolicy: {
      implementation: 'clean-room runtime and host example',
      allowedArtSources: [
        'original art',
        'licensed art',
        'user-provided art',
      ],
      privateCodexCodeOrAssetsCopied: false,
      privateCodexBuiltInAssetsCopied: false,
    },
    contract: {
      file: 'sprite-pet-contract.json',
      name: contract.name,
      atlas: contract.atlas,
      rows: contract.rows.map(({ row, state, frameCount, durationsMs }) => ({
        row,
        state,
        frameCount,
        durationsMs,
      })),
    },
    includedPetPackage: demoPackage
      ? {
          id: demoPackage.packageId,
          source: 'user-provided --package input',
          sourceManifestPath: demoPackage.sourceManifestPath,
          sourceSpritePath: demoPackage.sourceSpritePath,
          targetDirectory: `pets/${demoPackage.packageId}`,
          demoSpritePath: demoPackage.spritePath,
        }
      : null,
    files,
  }
}

function buildRuntimeModule(contract) {
  return `// Clean-room sprite-pet runtime exported from Nexus.
// This file contains no private Codex app code and no built-in Codex assets.

export const SPRITE_PET_CONTRACT = ${JSON.stringify(contract, null, 2)}

export const SPRITE_PET_COLUMNS = SPRITE_PET_CONTRACT.atlas.columns
export const SPRITE_PET_ROWS = SPRITE_PET_CONTRACT.atlas.rows
export const SPRITE_PET_CELL_WIDTH = SPRITE_PET_CONTRACT.atlas.cellWidth
export const SPRITE_PET_CELL_HEIGHT = SPRITE_PET_CONTRACT.atlas.cellHeight
export const SPRITE_PET_ACTIVE_LOOP_COUNT = 3
export const SPRITE_PET_SLOW_IDLE_DURATION_MULTIPLIER = 6
export const SPRITE_PET_ANIMATION_STATES = SPRITE_PET_CONTRACT.rows.map((row) => row.state)
export const SPRITE_PET_ANIMATIONS = Object.fromEntries(
  SPRITE_PET_CONTRACT.rows.map((row) => [
    row.state,
    {
      row: row.row,
      columns: Array.from({ length: row.frameCount }, (_, index) => index),
      durationsMs: row.durationsMs,
    },
  ]),
)

export const SPRITE_PET_INITIAL_CURSOR = {
  state: 'idle',
  frameIndex: 0,
  loopsRemaining: 0,
  requestKey: 'initial',
}

export function isSpritePetAnimationState(value) {
  return typeof value === 'string' && SPRITE_PET_ANIMATION_STATES.includes(value.trim())
}

export function getSpritePetFrame(state, frameIndex) {
  const animation = SPRITE_PET_ANIMATIONS[state] ?? SPRITE_PET_ANIMATIONS.idle
  const safeIndex = animation.columns.length
    ? Math.abs(frameIndex) % animation.columns.length
    : 0

  return {
    row: animation.row,
    column: animation.columns[safeIndex] ?? 0,
    durationMs: animation.durationsMs[safeIndex] ?? animation.durationsMs.at(-1) ?? 120,
  }
}

export function getSpritePetFrameCount(state) {
  return SPRITE_PET_ANIMATIONS[state]?.columns.length ?? SPRITE_PET_ANIMATIONS.idle.columns.length
}

export function advanceSpritePetAnimationCursor(
  current,
  requestedState,
  requestKey,
  options = {},
) {
  const frameCount = getSpritePetFrameCount(current.state)
  const nextFrameIndex = current.frameIndex + 1

  if (nextFrameIndex < frameCount) {
    return {
      ...current,
      frameIndex: nextFrameIndex,
    }
  }

  if (current.state === 'idle') {
    return {
      ...current,
      frameIndex: 0,
    }
  }

  if (options.loopRequestedState && current.state === requestedState && current.requestKey === requestKey) {
    return {
      ...current,
      frameIndex: 0,
      loopsRemaining: SPRITE_PET_ACTIVE_LOOP_COUNT,
    }
  }

  const nextLoopsRemaining = current.loopsRemaining - 1
  if (nextLoopsRemaining > 0) {
    return {
      ...current,
      frameIndex: 0,
      loopsRemaining: nextLoopsRemaining,
    }
  }

  return {
    state: 'idle',
    frameIndex: 0,
    loopsRemaining: 0,
    requestKey: current.requestKey,
    idleDurationMultiplier: SPRITE_PET_SLOW_IDLE_DURATION_MULTIPLIER,
  }
}

export function createSpritePetRequestKey(parts) {
  return parts.map((part) => part ?? '').join(':')
}

export function applySpritePetStateRequest({
  current,
  requestedState,
  requestKey,
  prefersReducedMotion = false,
}) {
  const safeRequestedState = isSpritePetAnimationState(requestedState) ? requestedState.trim() : 'idle'

  if (prefersReducedMotion) {
    return {
      state: safeRequestedState,
      frameIndex: 0,
      loopsRemaining: 0,
      requestKey,
    }
  }

  if (safeRequestedState === 'idle') {
    if (current.state === 'idle') {
      return {
        ...current,
        frameIndex: 0,
        requestKey,
      }
    }

    return current
  }

  if (current.requestKey === requestKey) {
    return current
  }

  return {
    state: safeRequestedState,
    frameIndex: 0,
    loopsRemaining: SPRITE_PET_ACTIVE_LOOP_COUNT,
    requestKey,
  }
}

export function mapSpritePetSignalsToState(input = {}) {
  if (input.gestureName === 'wave') return 'waving'
  if (input.gestureName) return 'jumping'

  switch (input.expressionSlot) {
    case 'thinking':
      return 'running'
    case 'happy':
    case 'speaking':
      return 'review'
    case 'sleepy':
    case 'listening':
      return 'waiting'
    case 'surprised':
    case 'touchHead':
    case 'touchFace':
    case 'touchBody':
      return 'jumping'
    case 'confused':
      return 'failed'
    case 'embarrassed':
      return 'waving'
    default:
      break
  }

  if (input.isSpeaking) return 'review'
  if (input.isListening) return 'waiting'
  if (input.isBusy) return 'running'
  if (input.isTouching) return 'jumping'

  switch (input.mood) {
    case 'thinking':
    case 'curious':
      return 'running'
    case 'happy':
    case 'excited':
    case 'proud':
    case 'playful':
      return 'review'
    case 'sleepy':
      return 'waiting'
    case 'surprised':
      return 'jumping'
    case 'confused':
    case 'worried':
      return 'failed'
    case 'embarrassed':
    case 'affectionate':
      return 'waving'
    default:
      return 'idle'
  }
}

export function resolveSpritePetRenderFrame(atlas = {}, cursor) {
  const columns = atlas.columns ?? SPRITE_PET_COLUMNS
  const rows = atlas.rows ?? SPRITE_PET_ROWS
  const cellWidth = atlas.cellWidth ?? SPRITE_PET_CELL_WIDTH
  const cellHeight = atlas.cellHeight ?? SPRITE_PET_CELL_HEIGHT
  const baseFrame = getSpritePetFrame(cursor.state, cursor.frameIndex)
  const durationMultiplier = cursor.state === 'idle'
    ? cursor.idleDurationMultiplier ?? 1
    : 1
  const frame = {
    ...baseFrame,
    durationMs: Math.round(baseFrame.durationMs * durationMultiplier),
  }
  const backgroundX = columns > 1 ? (frame.column / (columns - 1)) * 100 : 0
  const backgroundY = rows > 1 ? (frame.row / (rows - 1)) * 100 : 0

  return {
    frame,
    columns,
    rows,
    cellWidth,
    cellHeight,
    aspectRatio: \`\${cellWidth} / \${cellHeight}\`,
    backgroundPosition: \`\${backgroundX}% \${backgroundY}%\`,
    backgroundSize: \`\${columns * 100}% \${rows * 100}%\`,
  }
}
`
}

function buildCss() {
  return `.sprite-pet-stage {
  display: grid;
  place-items: center;
  inline-size: min(55vmin, 360px);
  margin: 0 auto;
  -webkit-app-region: drag;
  app-region: drag;
}

.sprite-pet-sprite {
  inline-size: 100%;
  aspect-ratio: var(--sprite-pet-aspect, 192 / 208);
  background-image: var(--sprite-pet-image);
  background-repeat: no-repeat;
  background-position: var(--sprite-pet-background-position, 0% 0%);
  background-size: var(--sprite-pet-background-size, 800% 900%);
  image-rendering: auto;
  transform: translate(
    var(--sprite-pet-gaze-x, 0px),
    var(--sprite-pet-gaze-y, 0px)
  ) scale(var(--sprite-pet-speech-scale, 1));
  transform-origin: 50% 88%;
  -webkit-app-region: drag;
  app-region: drag;
  user-select: none;
}

.sprite-pet-no-drag,
.sprite-pet-no-drag * {
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

@media (prefers-reduced-motion: reduce) {
  .sprite-pet-sprite {
    transform: none;
  }
}
`
}

function buildRuntimeTypes() {
  return `export type SpritePetAnimationState =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review'

export type SpritePetFrame = {
  row: number
  column: number
  durationMs: number
}

export type SpritePetAnimationCursor = {
  state: SpritePetAnimationState
  frameIndex: number
  loopsRemaining: number
  requestKey: string
  idleDurationMultiplier?: number
}

export type SpritePetAdvanceOptions = {
  loopRequestedState?: boolean
}

export type SpritePetAtlasDefinition = {
  imagePath?: string
  columns?: number
  rows?: number
  cellWidth?: number
  cellHeight?: number
  imageRendering?: 'pixelated' | 'auto'
}

export type SpritePetRenderFrame = {
  frame: SpritePetFrame
  columns: number
  rows: number
  cellWidth: number
  cellHeight: number
  aspectRatio: string
  backgroundPosition: string
  backgroundSize: string
}

export type SpritePetSignalInput = {
  mood?: string
  expressionSlot?: string
  gestureName?: string
  isSpeaking?: boolean
  isListening?: boolean
  isBusy?: boolean
  isTouching?: boolean
}

export const SPRITE_PET_CONTRACT: {
  name: string
  sourcePolicy: string
  privateCodexCodeOrAssetsCopied: false
  atlas: {
    width: number
    height: number
    columns: number
    rows: number
    cellWidth: number
    cellHeight: number
  }
  rows: Array<{
    row: number
    state: SpritePetAnimationState
    frameCount: number
    transparentUnusedCells: number
    durationsMs: number[]
  }>
  alphaPolicy: string
}
export const SPRITE_PET_COLUMNS: number
export const SPRITE_PET_ROWS: number
export const SPRITE_PET_CELL_WIDTH: number
export const SPRITE_PET_CELL_HEIGHT: number
export const SPRITE_PET_ACTIVE_LOOP_COUNT: number
export const SPRITE_PET_SLOW_IDLE_DURATION_MULTIPLIER: number
export const SPRITE_PET_ANIMATION_STATES: SpritePetAnimationState[]
export const SPRITE_PET_ANIMATIONS: Record<SpritePetAnimationState, {
  row: number
  columns: number[]
  durationsMs: number[]
}>
export const SPRITE_PET_INITIAL_CURSOR: SpritePetAnimationCursor

export function isSpritePetAnimationState(value: unknown): value is SpritePetAnimationState
export function getSpritePetFrame(state: SpritePetAnimationState | string, frameIndex: number): SpritePetFrame
export function getSpritePetFrameCount(state: SpritePetAnimationState | string): number
export function advanceSpritePetAnimationCursor(
  current: SpritePetAnimationCursor,
  requestedState: SpritePetAnimationState | string,
  requestKey: string,
  options?: SpritePetAdvanceOptions,
): SpritePetAnimationCursor
export function createSpritePetRequestKey(parts: Array<string | null | undefined>): string
export function applySpritePetStateRequest(input: {
  current: SpritePetAnimationCursor
  requestedState: SpritePetAnimationState | string
  requestKey: string
  prefersReducedMotion?: boolean
}): SpritePetAnimationCursor
export function mapSpritePetSignalsToState(input?: SpritePetSignalInput): SpritePetAnimationState
export function resolveSpritePetRenderFrame(
  atlas: SpritePetAtlasDefinition,
  cursor: SpritePetAnimationCursor,
): SpritePetRenderFrame
`
}

function buildPackageJson() {
  return `${JSON.stringify({
    name: '@nexus/sprite-pet-runtime',
    version: '0.0.0-cleanroom',
    private: true,
    type: 'module',
    sideEffects: [
      './sprite-pet.css',
    ],
    main: './sprite-pet-runtime.mjs',
    module: './sprite-pet-runtime.mjs',
    types: './sprite-pet-runtime.d.ts',
    exports: {
      '.': {
        types: './sprite-pet-runtime.d.ts',
        import: './sprite-pet-runtime.mjs',
      },
      './contract': './sprite-pet-contract.json',
      './manifest': './export-manifest.json',
      './style.css': './sprite-pet.css',
      './demo.html': './demo.html',
      './electron-host-example': './electron-host-example.mjs',
    },
  }, null, 2)}\n`
}

function buildElectronHostExample() {
  return `// Clean-room Electron host example for the exported sprite-pet demo.
// This is a reference shell only; adapt sizing, IPC, tray, and persistence for your app.

import { app, BrowserWindow, screen } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function createPetWindow() {
  const { workArea } = screen.getPrimaryDisplay()
  const width = 280
  const height = 320

  const window = new BrowserWindow({
    width,
    height,
    x: Math.round(workArea.x + workArea.width - width - 28),
    y: Math.round(workArea.y + workArea.height - height - 28),
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.loadFile(path.join(__dirname, 'demo.html'))
  return window
}

app.whenReady().then(() => {
  createPetWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createPetWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
`
}

function buildDemoHtml(demoSpritePath) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sprite Pet Runtime Demo</title>
  <link rel="stylesheet" href="./sprite-pet.css">
  <style>
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      gap: 18px;
      font-family: system-ui, sans-serif;
      background: #f5f7f8;
      color: #162022;
    }

    main {
      display: grid;
      gap: 18px;
      width: min(92vw, 560px);
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 8px;
    }

    button {
      border: 1px solid #c7d0d3;
      border-radius: 8px;
      background: #ffffff;
      padding: 8px 10px;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }

    button[data-active="true"] {
      border-color: #1d6f72;
      background: #dff3f1;
    }
  </style>
</head>
<body>
  <main>
    <div class="sprite-pet-stage">
      <div id="pet" class="sprite-pet-sprite" role="img" aria-label="Sprite pet demo"></div>
    </div>
    <div class="controls sprite-pet-no-drag" id="controls"></div>
  </main>
  <script type="module">
    import {
      SPRITE_PET_ANIMATION_STATES,
      SPRITE_PET_INITIAL_CURSOR,
      advanceSpritePetAnimationCursor,
      applySpritePetStateRequest,
      createSpritePetRequestKey,
      resolveSpritePetRenderFrame,
    } from './sprite-pet-runtime.mjs'

    const params = new URLSearchParams(window.location.search)
    const spritePath = params.get('sprite') || '${demoSpritePath}'
    const petElement = document.querySelector('#pet')
    const controlsElement = document.querySelector('#controls')
    let requestedState = params.get('state') || 'idle'
    let requestKey = createSpritePetRequestKey(['demo', requestedState])
    let cursor = SPRITE_PET_INITIAL_CURSOR

    function requestState(state) {
      requestedState = state
      requestKey = createSpritePetRequestKey(['demo', requestedState])
      cursor = applySpritePetStateRequest({ current: cursor, requestedState, requestKey })
      render()
    }

    function render() {
      const renderFrame = resolveSpritePetRenderFrame({}, cursor)
      petElement.style.setProperty('--sprite-pet-image', \`url("\${spritePath}")\`)
      petElement.style.setProperty('--sprite-pet-aspect', renderFrame.aspectRatio)
      petElement.style.setProperty('--sprite-pet-background-position', renderFrame.backgroundPosition)
      petElement.style.setProperty('--sprite-pet-background-size', renderFrame.backgroundSize)
      petElement.dataset.spritePetState = cursor.state
      petElement.dataset.spritePetFrame = String(cursor.frameIndex)
      petElement.dataset.spritePetRow = String(renderFrame.frame.row)
      petElement.dataset.spritePetColumn = String(renderFrame.frame.column)

      for (const button of controlsElement.querySelectorAll('button')) {
        button.dataset.active = String(button.dataset.state === requestedState)
      }
    }

    for (const state of SPRITE_PET_ANIMATION_STATES) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = state
      button.dataset.state = state
      button.addEventListener('click', () => requestState(state))
      controlsElement.append(button)
    }

    requestState(requestedState)

    function tick() {
      const renderFrame = resolveSpritePetRenderFrame({}, cursor)
      window.setTimeout(() => {
        cursor = advanceSpritePetAnimationCursor(cursor, requestedState, requestKey, { loopRequestedState: true })
        render()
        tick()
      }, renderFrame.frame.durationMs)
    }

    tick()
  </script>
</body>
</html>
`
}

function buildReadme({ includedPackageId }) {
  const demoPath = includedPackageId
    ? `The demo loads \`./pets/${includedPackageId}/spritesheet.*\` by default.`
    : 'The demo expects `./spritesheet.png` by default, or pass `?sprite=./path/to/spritesheet.png`.'

  return `# Sprite Pet Runtime

This folder is a clean-room portable runtime for Codex-style sprite pets. It copies the mechanism contract, not private Codex application code or built-in Codex assets.

Files:

- \`sprite-pet-runtime.mjs\`: standalone ESM runtime with no React, Electron, or Nexus imports.
- \`sprite-pet-runtime.d.ts\`: TypeScript declarations for the standalone runtime.
- \`sprite-pet-contract.json\`: machine-readable atlas and row contract.
- \`export-manifest.json\`: machine-readable clean-room source policy and file hashes.
- \`sprite-pet.css\`: CSS renderer shell for the exported runtime.
- \`demo.html\`: browser demo that imports the standalone runtime.
- \`electron-host-example.mjs\`: clean-room transparent always-on-top Electron window shell.
- \`package.json\`: local ESM package metadata for bundlers and TypeScript.

${demoPath}

Playback matches the Codex-style sprite pet pattern by default: each non-idle state is a transient action that plays three row loops, then returns to a slow idle row with idle durations multiplied by 6. Use a new \`requestKey\` to trigger a fresh action. The demo buttons pass \`{ loopRequestedState: true }\` so creators can inspect one row continuously.

Basic usage:

\`\`\`js
import {
  SPRITE_PET_INITIAL_CURSOR,
  advanceSpritePetAnimationCursor,
  applySpritePetStateRequest,
  mapSpritePetSignalsToState,
  resolveSpritePetRenderFrame,
} from './sprite-pet-runtime.mjs'

const atlas = { imagePath: './pets/my-pet/spritesheet.png' }
let cursor = SPRITE_PET_INITIAL_CURSOR
let requestedState = mapSpritePetSignalsToState({ isListening: true })
let requestKey = 'voice:listening'

cursor = applySpritePetStateRequest({ current: cursor, requestedState, requestKey })

function tick() {
  const renderFrame = resolveSpritePetRenderFrame(atlas, cursor)
  // CSS renderers can use renderFrame.backgroundPosition and renderFrame.backgroundSize.
  // Canvas/native renderers can use renderFrame.frame.row and renderFrame.frame.column.
  cursor = advanceSpritePetAnimationCursor(cursor, requestedState, requestKey)
  setTimeout(tick, renderFrame.frame.durationMs)
}
\`\`\`

Package-style import from another ESM app:

\`\`\`js
import {
  SPRITE_PET_INITIAL_CURSOR,
  resolveSpritePetRenderFrame,
} from '@nexus/sprite-pet-runtime'
import '@nexus/sprite-pet-runtime/style.css'
\`\`\`

Electron desktop-pet shell:

\`\`\`bash
electron ./electron-host-example.mjs
\`\`\`

The generated CSS marks the pet stage as an Electron drag region and marks the demo controls as no-drag, so the frameless window can be moved without breaking button clicks.
`
}

async function copyDemoPackage({ manifestPath, outputDir }) {
  assertNotPrivateCodexPetSource(manifestPath)
  const sourcePackage = await readSpritePetPackage(manifestPath)
  assertNotPrivateCodexPetSource(sourcePackage.sourceSpritePath)
  const sourceDirectory = path.dirname(manifestPath)
  const packageId = slugifySpritePetId(sourcePackage.id || sourcePackage.displayName || path.basename(sourceDirectory))
  const spriteExtension = path.extname(sourcePackage.sourceSpritePath).toLowerCase()
  const targetSpriteName = `spritesheet${spriteExtension}`
  const packageDirectory = path.join(outputDir, 'pets', packageId)

  await fs.mkdir(packageDirectory, { recursive: true })
  await fs.copyFile(sourcePackage.sourceSpritePath, path.join(packageDirectory, targetSpriteName))
  await fs.writeFile(
    path.join(packageDirectory, 'pet.json'),
    `${JSON.stringify({
      id: packageId,
      displayName: sourcePackage.displayName,
      description: sourcePackage.description || '',
      spritesheetPath: targetSpriteName,
    }, null, 2)}\n`,
    'utf8',
  )

  return {
    packageId,
    spritePath: `./pets/${packageId}/${targetSpriteName}`,
    sourceManifestPath: manifestPath,
    sourceSpritePath: sourcePackage.sourceSpritePath,
  }
}

try {
  const options = parseArgs(process.argv.slice(2))

  if (options.help) {
    printUsage()
    process.exit(0)
  }

  if (await pathExists(options.outputDir)) {
    if (!options.force) {
      throw new Error(`Output folder already exists: ${options.outputDir}. Re-run with --force to replace it.`)
    }
    await fs.rm(options.outputDir, { recursive: true, force: true })
  }

  const contract = buildContract()
  const demoPackage = options.packagePath
    ? await copyDemoPackage({
        manifestPath: await resolveManifestPath(options.packagePath),
        outputDir: options.outputDir,
      })
    : null
  const demoSpritePath = demoPackage?.spritePath ?? './spritesheet.png'

  await fs.mkdir(options.outputDir, { recursive: true })
  await fs.writeFile(
    path.join(options.outputDir, 'sprite-pet-runtime.mjs'),
    buildRuntimeModule(contract),
    'utf8',
  )
  await fs.writeFile(
    path.join(options.outputDir, 'sprite-pet-contract.json'),
    `${JSON.stringify(contract, null, 2)}\n`,
    'utf8',
  )
  await fs.writeFile(
    path.join(options.outputDir, 'sprite-pet-runtime.d.ts'),
    buildRuntimeTypes(),
    'utf8',
  )
  await fs.writeFile(
    path.join(options.outputDir, 'package.json'),
    buildPackageJson(),
    'utf8',
  )
  await fs.writeFile(
    path.join(options.outputDir, 'README.md'),
    buildReadme({ includedPackageId: demoPackage?.packageId ?? '' }),
    'utf8',
  )
  await fs.writeFile(
    path.join(options.outputDir, 'sprite-pet.css'),
    buildCss(),
    'utf8',
  )
  await fs.writeFile(
    path.join(options.outputDir, 'demo.html'),
    buildDemoHtml(demoSpritePath),
    'utf8',
  )
  await fs.writeFile(
    path.join(options.outputDir, 'electron-host-example.mjs'),
    buildElectronHostExample(),
    'utf8',
  )
  await fs.writeFile(
    path.join(options.outputDir, 'export-manifest.json'),
    `${JSON.stringify(buildExportManifest({
      contract,
      demoPackage,
      files: await collectExportFiles(options.outputDir),
    }), null, 2)}\n`,
    'utf8',
  )

  console.log('Sprite pet runtime exported')
  console.log(`- output: ${options.outputDir}`)
  console.log('- runtime: sprite-pet-runtime.mjs')
  console.log('- types: sprite-pet-runtime.d.ts')
  console.log('- contract: sprite-pet-contract.json')
  console.log('- manifest: export-manifest.json')
  console.log('- package: package.json')
  console.log('- css: sprite-pet.css')
  console.log('- demo: demo.html')
  console.log('- electron host: electron-host-example.mjs')
  if (demoPackage) {
    console.log(`- demo package: pets/${demoPackage.packageId}`)
  }
  console.log('- private Codex code/assets copied: false')
} catch (error) {
  console.error(`Sprite pet runtime export failed: ${error?.message ?? String(error)}`)
  process.exit(1)
}
