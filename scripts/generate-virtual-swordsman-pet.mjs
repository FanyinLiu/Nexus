#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import {
  SPRITE_PET_ATLAS_HEIGHT,
  SPRITE_PET_ATLAS_WIDTH,
  SPRITE_PET_CELL_HEIGHT,
  SPRITE_PET_CELL_WIDTH,
  SPRITE_PET_ROW_CONTRACT,
  readSpritePetPackage,
} from '../electron/services/spritePetPackage.js'

const DEFAULT_OUTPUT_DIR = 'public/pets/original-virtual-swordsman'
const LOW_RES_SCALE = 0.5

function printUsage() {
  console.error([
    'Usage: node scripts/generate-virtual-swordsman-pet.mjs [options]',
    '',
    'Generates a clean-room Codex-style mascot pet: round body, terminal face,',
    'short limbs, low-detail pixel atlas, and the same 8x9 animation contract.',
    '',
    'Options:',
    '  --output-dir <dir>       Package directory. Default: public/pets/original-virtual-swordsman',
    '  --id <id>                Manifest id. Default: folder name',
    '  --display-name <name>    Display name. Default: Original Code Mascot',
    '  --body-color <hex>       Main mascot color. Default: #5f85ff',
    '  --shell-color <hex>      Dark outline/shadow color. Default: #2844c7',
    '  --screen-color <hex>     Terminal face color. Default: #24306d',
    '  --accent-color <hex>     Face/accent color. Default: #79f2ff',
    '  --accessory <none|swords|sprout|spark>  Small attached accessory. Default: none',
    '  --force                  Replace an existing package directory.',
  ].join('\n'))
}

function parseArgs(argv) {
  const options = {
    outputDir: DEFAULT_OUTPUT_DIR,
    id: '',
    displayName: 'Original Code Mascot',
    bodyColor: '#5f85ff',
    shellColor: '#2844c7',
    screenColor: '#24306d',
    accentColor: '#79f2ff',
    accessory: 'none',
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
    if (arg === '--output-dir' || arg === '--id' || arg === '--display-name'
      || arg === '--body-color' || arg === '--shell-color' || arg === '--screen-color'
      || arg === '--accent-color' || arg === '--accessory') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error(`${arg} requires a value.`)
      }
      index += 1
      if (arg === '--output-dir') options.outputDir = value
      if (arg === '--id') options.id = value
      if (arg === '--display-name') options.displayName = value
      if (arg === '--body-color') options.bodyColor = value
      if (arg === '--shell-color') options.shellColor = value
      if (arg === '--screen-color') options.screenColor = value
      if (arg === '--accent-color') options.accentColor = value
      if (arg === '--accessory') options.accessory = value
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }

  if (!['none', 'swords', 'sprout', 'spark'].includes(options.accessory)) {
    throw new Error('--accessory must be one of: none, swords, sprout, spark.')
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

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value)
}

function sanitizeId(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function motionFor(row, frame, frameCount) {
  const cycle = (frame / frameCount) * Math.PI * 2

  switch (row) {
    case 0:
      return {
        bob: Math.sin(cycle) * 1.1,
        face: frame === 1 || frame === 5 ? 'blink' : 'idle',
        arm: Math.sin(cycle) * 0.9,
        foot: Math.sin(cycle + 0.4) * 0.8,
      }
    case 1:
      return {
        direction: 1,
        bob: Math.sin(cycle * 2) * 3.8,
        bodyX: Math.sin(cycle) * 4.6,
        lean: 6,
        arm: Math.cos(cycle) * 4,
        leg: Math.sin(cycle) * 5,
        face: 'run-right',
      }
    case 2:
      return {
        direction: -1,
        bob: Math.sin(cycle * 2) * 3.8,
        bodyX: Math.sin(cycle) * -4.6,
        lean: 6,
        arm: Math.cos(cycle) * 4,
        leg: Math.sin(cycle) * 5,
        face: 'run-left',
      }
    case 3:
      return {
        bob: [0, -2, -1, 1][frame] ?? 0,
        face: 'idle',
        wave: [-2, -22, -13, -4][frame] ?? -4,
        arm: [0, 4, -2, 0][frame] ?? 0,
      }
    case 4:
      return {
        bob: [8, -7, -25, -12, 7][frame] ?? 0,
        squishX: [1.06, 0.98, 0.94, 1, 1.05][frame] ?? 1,
        squishY: [0.94, 1.03, 1.08, 1.02, 0.95][frame] ?? 1,
        arm: [0, -4, -8, -4, 0][frame] ?? 0,
        leg: [-2, 2, 5, 1, -2][frame] ?? 0,
        face: 'idle',
      }
    case 5:
      return {
        bob: [2, 5, 7, 6, 2, 5, 7, 6][frame] ?? 2,
        lean: [-4, 3, -2, 4, -4, 3, -2, 4][frame] ?? 0,
        face: ['idle', 'ouch', 'x', 'sad', 'idle', 'ouch', 'x', 'sad'][frame] ?? 'sad',
        arm: [-2, 5, -5, 4, -2, 5, -5, 4][frame] ?? 0,
      }
    case 6:
      return {
        bob: Math.sin(cycle) * 1.2,
        face: frame === 1 || frame === 5 ? 'pause' : frame === 2 ? 'think' : 'idle',
        arm: Math.sin(cycle) * 1.2,
      }
    case 7:
      return {
        bob: Math.sin(cycle * 2) * 1.8,
        bodyX: Math.sin(cycle) * 0.8,
        face: ['idle', 'happy', 'blink', 'pause', 'idle', 'happy'][frame] ?? 'idle',
        arm: Math.cos(cycle) * 1.5,
        console: true,
      }
    case 8:
      return {
        bob: [0, -3, -4, -1, 0, 1][frame] ?? 0,
        face: ['idle', 'happy', 'happy', 'idle', 'idle', 'happy'][frame] ?? 'happy',
        arm: [0, -4, -8, -4, 0, -2][frame] ?? 0,
      }
    default:
      return {}
  }
}

function drawFace(face, colors) {
  const { accentColor } = colors
  if (face === 'blink') {
    return `<path d="M-21 -38 q8 5 16 0" stroke="${accentColor}" stroke-width="4" stroke-linecap="round" fill="none"/>
      <path d="M7 -38 q8 5 16 0" stroke="${accentColor}" stroke-width="4" stroke-linecap="round" fill="none"/>`
  }
  if (face === 'happy') {
    return `<path d="M-21 -39 q8 10 16 0" stroke="${accentColor}" stroke-width="4" stroke-linecap="round" fill="none"/>
      <path d="M7 -39 q8 10 16 0" stroke="${accentColor}" stroke-width="4" stroke-linecap="round" fill="none"/>`
  }
  if (face === 'pause') {
    return `<path d="M-16 -44 v15" stroke="${accentColor}" stroke-width="6" stroke-linecap="round"/>
      <path d="M16 -44 v15" stroke="${accentColor}" stroke-width="6" stroke-linecap="round"/>`
  }
  if (face === 'think') {
    return `<path d="M-18 -41 v11" stroke="${accentColor}" stroke-width="5" stroke-linecap="round"/>
      <path d="M10 -46 q12 3 7 15" stroke="${accentColor}" stroke-width="4" stroke-linecap="round" fill="none"/>`
  }
  if (face === 'x') {
    return `<path d="M-21 -45 l13 13 M-8 -45 l-13 13" stroke="${accentColor}" stroke-width="4" stroke-linecap="round"/>
      <path d="M9 -45 l13 13 M22 -45 l-13 13" stroke="${accentColor}" stroke-width="4" stroke-linecap="round"/>`
  }
  if (face === 'sad') {
    return `<path d="M-21 -39 q8 5 16 0" stroke="${accentColor}" stroke-width="4" stroke-linecap="round" fill="none"/>
      <path d="M7 -39 q8 5 16 0" stroke="${accentColor}" stroke-width="4" stroke-linecap="round" fill="none"/>
      <path d="M-10 -22 q10 -7 20 0" stroke="${accentColor}" stroke-width="3" stroke-linecap="round" fill="none"/>`
  }
  if (face === 'ouch') {
    return `<path d="M-23 -38 l12 0 M8 -45 q14 8 0 16" stroke="${accentColor}" stroke-width="4" stroke-linecap="round" fill="none"/>`
  }
  if (face === 'run-left') {
    return `<path d="M-24 -38 h18" stroke="${accentColor}" stroke-width="4" stroke-linecap="round"/>
      <path d="M17 -46 l-13 8 l13 8" stroke="${accentColor}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
  }

  return `<path d="M-22 -46 l14 9 l-14 9" stroke="${accentColor}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M8 -36 h16" stroke="${accentColor}" stroke-width="4" stroke-linecap="round"/>`
}

function drawAccessory(accessory, colors) {
  const { accentColor, shellColor, outlineColor } = colors
  if (accessory === 'swords') {
    return `<g opacity="0.82">
      <path d="M-56 12 L-78 48" stroke="${outlineColor}" stroke-width="7" stroke-linecap="round"/>
      <path d="M-54 8 L-74 45" stroke="#d7dde7" stroke-width="3" stroke-linecap="round"/>
      <path d="M56 12 L78 48" stroke="${outlineColor}" stroke-width="7" stroke-linecap="round"/>
      <path d="M54 8 L76 45" stroke="#d7dde7" stroke-width="3" stroke-linecap="round"/>
    </g>`
  }
  if (accessory === 'sprout') {
    return `<g transform="translate(0 -83)" stroke="${shellColor}" stroke-width="3" stroke-linecap="round" fill="none">
      <path d="M0 8 C-3 0 1 -6 0 -13"/>
      <path d="M0 -4 C-14 -12 -24 -8 -25 2" fill="#9be76f"/>
      <path d="M0 -5 C14 -15 25 -9 26 2" fill="#9be76f"/>
    </g>`
  }
  if (accessory === 'spark') {
    return `<g stroke="${accentColor}" stroke-width="3" stroke-linecap="round" opacity="0.78">
      <path d="M51 -80 h13 M57 -87 v13"/>
    </g>`
  }
  return ''
}

function drawConsole(colors) {
  return `<g transform="translate(29 28) rotate(2)">
    <path d="M-21 -28 h66 q7 0 7 7 v45 q0 7 -7 7 h-66 q-7 0 -7 -7 v-45 q0 -7 7 -7z" fill="${colors.outlineColor}"/>
    <path d="M-17 -24 h58 q6 0 6 6 v38 q0 6 -6 6 h-58 q-6 0 -6 -6 v-38 q0 -6 6 -6z" fill="${colors.screenColor}" opacity="0.98"/>
    <path d="M-4 -6 l11 9 l-11 9" stroke="${colors.accentColor}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M16 13 h18" stroke="${colors.accentColor}" stroke-width="5" stroke-linecap="round"/>
  </g>`
}

function drawMascot(motion, colors, accessory) {
  const direction = motion.direction ?? 1
  const mirror = direction < 0 ? -1 : 1
  const bodyX = motion.bodyX ?? 0
  const bob = motion.bob ?? 0
  const lean = (motion.lean ?? 0) * direction
  const squishX = motion.squishX ?? 1
  const squishY = motion.squishY ?? 1
  const arm = motion.arm ?? 0
  const leg = motion.leg ?? 0
  const wave = motion.wave ?? null
  const face = motion.face ?? 'idle'
  const leftArmY = wave ?? 22 + arm
  const rightArmY = 22 - arm
  const leftFootY = 54 + (motion.foot ?? 0) + leg
  const rightFootY = 54 - (motion.foot ?? 0) - leg

  return `<g transform="translate(${96 + bodyX} ${126 + bob}) scale(${squishX} ${squishY})">
    <g transform="scale(${mirror} 1) rotate(${lean})">
      ${drawAccessory(accessory, colors)}
      <g fill="${colors.outlineColor}">
        <ellipse cx="-43" cy="22" rx="12" ry="20" transform="rotate(15 -43 22)"/>
        <ellipse cx="43" cy="22" rx="12" ry="20" transform="rotate(-15 43 22)"/>
        <ellipse cx="-15" cy="${leftFootY}" rx="12" ry="18"/>
        <ellipse cx="15" cy="${rightFootY}" rx="12" ry="18"/>
        <path d="M-31 9 q31 9 62 0 v24 q0 21 -14 30 q-17 8 -34 0 q-14 -9 -14 -30z"/>
        <circle cx="-43" cy="-45" r="25"/>
        <circle cx="-24" cy="-63" r="25"/>
        <circle cx="0" cy="-68" r="29"/>
        <circle cx="27" cy="-63" r="25"/>
        <circle cx="46" cy="-45" r="26"/>
        <circle cx="-49" cy="-23" r="24"/>
        <circle cx="49" cy="-23" r="24"/>
        <circle cx="-24" cy="-20" r="25"/>
        <circle cx="24" cy="-20" r="25"/>
      </g>
      <g fill="${colors.shellColor}">
        <ellipse cx="-43" cy="22" rx="9" ry="16" transform="rotate(15 -43 22)"/>
        <ellipse cx="43" cy="22" rx="9" ry="16" transform="rotate(-15 43 22)"/>
        <ellipse cx="-15" cy="${leftFootY}" rx="8" ry="13"/>
        <ellipse cx="15" cy="${rightFootY}" rx="8" ry="13"/>
        <path d="M-26 13 q26 7 52 0 v21 q0 16 -11 23 q-15 6 -30 0 q-11 -7 -11 -23z"/>
        <circle cx="-43" cy="-45" r="21"/>
        <circle cx="-24" cy="-63" r="21"/>
        <circle cx="0" cy="-68" r="25"/>
        <circle cx="27" cy="-63" r="21"/>
        <circle cx="46" cy="-45" r="22"/>
        <circle cx="-48" cy="-22" r="20"/>
        <circle cx="48" cy="-22" r="20"/>
        <circle cx="-23" cy="-20" r="21"/>
        <circle cx="23" cy="-20" r="21"/>
      </g>
      <g fill="${colors.bodyColor}">
        <ellipse cx="-41" cy="-48" rx="19" ry="21"/>
        <ellipse cx="-23" cy="-64" rx="19" ry="19"/>
        <ellipse cx="0" cy="-69" rx="21" ry="21"/>
        <ellipse cx="26" cy="-64" rx="19" ry="19"/>
        <ellipse cx="44" cy="-48" rx="20" ry="22"/>
        <ellipse cx="-46" cy="-25" rx="19" ry="20"/>
        <ellipse cx="46" cy="-25" rx="19" ry="20"/>
        <ellipse cx="-23" cy="-22" rx="21" ry="18"/>
        <ellipse cx="23" cy="-22" rx="21" ry="18"/>
        <path d="M-23 16 q23 6 46 0 v18 q0 13 -9 18 q-14 5 -28 0 q-9 -5 -9 -18z"/>
      </g>
      <path d="M-35 -55 h70 q8 0 8 8 v31 q0 8 -8 8 h-70 q-8 0 -8 -8 v-31 q0 -8 8 -8z" fill="${colors.outlineColor}"/>
      <path d="M-31 -51 h62 q6 0 6 6 v23 q0 6 -6 6 h-62 q-6 0 -6 -6 v-23 q0 -6 6 -6z" fill="${colors.screenColor}"/>
      ${drawFace(face, colors)}

      <path d="M-10 25 l10 6 l10 -6" stroke="${colors.accentColor}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.88"/>
      <path d="M-12 42 h24" stroke="${colors.accentColor}" stroke-width="4" stroke-linecap="round" opacity="0.48"/>
      <ellipse cx="-43" cy="${leftArmY}" rx="9" ry="14" fill="${colors.bodyColor}" transform="rotate(${14 + arm} -43 ${leftArmY})"/>
      <ellipse cx="43" cy="${rightArmY}" rx="9" ry="14" fill="${colors.bodyColor}" transform="rotate(${-14 - arm} 43 ${rightArmY})"/>
      ${motion.console ? drawConsole(colors) : ''}
    </g>
  </g>`
}

function drawCell(rowContract, frame, colors, accessory) {
  const motion = motionFor(rowContract.row, frame, rowContract.frameCount)
  return `<g transform="translate(${frame * SPRITE_PET_CELL_WIDTH * LOW_RES_SCALE} ${rowContract.row * SPRITE_PET_CELL_HEIGHT * LOW_RES_SCALE}) scale(${LOW_RES_SCALE})">
    ${drawMascot(motion, colors, accessory)}
  </g>`
}

function buildAtlasSvg(colors, accessory) {
  const lowWidth = SPRITE_PET_ATLAS_WIDTH * LOW_RES_SCALE
  const lowHeight = SPRITE_PET_ATLAS_HEIGHT * LOW_RES_SCALE
  const cells = []

  for (const rowContract of SPRITE_PET_ROW_CONTRACT) {
    for (let frame = 0; frame < rowContract.frameCount; frame += 1) {
      cells.push(drawCell(rowContract, frame, colors, accessory))
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lowWidth}" height="${lowHeight}" viewBox="0 0 ${lowWidth} ${lowHeight}">
    ${cells.join('\n')}
  </svg>`
}

function buildManifest({ id, displayName }) {
  return {
    id,
    displayName,
    description: 'Clean-room Codex-style mascot sprite pet with terminal face and 8x9 pixel atlas motions.',
    spritesheetPath: 'spritesheet.png',
  }
}

function buildReadme({ displayName, id, colors, accessory }) {
  return `# ${displayName}

This is a clean-room Codex-style sprite pet. It follows the observed Codex pet model:

- rounded mascot body instead of human character proportions
- terminal-style face
- very short limbs
- low-detail pixelated atlas
- 8 columns x 9 rows, 192x208 cells
- original art only; no Codex app assets copied

Package id: \`${id}\`
Accessory: \`${accessory}\`

Palette:

- body: \`${colors.bodyColor}\`
- shell: \`${colors.shellColor}\`
- screen: \`${colors.screenColor}\`
- accent: \`${colors.accentColor}\`

Regenerate examples:

\`\`\`bash
npm run pet:generate-codex-style -- --force
npm run pet:generate-codex-style -- --id my-pet --display-name "My Pet" --body-color "#62a6ff" --accessory sprout --output-dir output/pets/my-pet --force
\`\`\`

Validate with:

\`\`\`bash
npm run pet:validate -- ${path.posix.join('public/pets', id)}
npm run pet:audit -- ${path.posix.join('public/pets', id)} --strict
\`\`\`
`
}

try {
  const options = parseArgs(process.argv.slice(2))

  if (options.help) {
    printUsage()
    process.exit(0)
  }

  const outputDir = path.resolve(process.cwd(), options.outputDir)
  const id = sanitizeId(options.id || path.basename(outputDir)) || 'codex-style-mascot'
  const colors = {
    bodyColor: options.bodyColor,
    shellColor: options.shellColor,
    screenColor: options.screenColor,
    accentColor: options.accentColor,
    outlineColor: '#071044',
  }

  for (const [name, value] of Object.entries(colors)) {
    if (!isHexColor(value)) {
      throw new Error(`${name} must be a 6-digit hex color like #5d7cff.`)
    }
  }

  if (await pathExists(outputDir)) {
    if (!options.force) {
      throw new Error(`Output directory already exists: ${outputDir}. Re-run with --force to replace it.`)
    }
    await fs.rm(outputDir, { recursive: true, force: true })
  }

  const lowResPng = await sharp(Buffer.from(buildAtlasSvg(colors, options.accessory)))
    .png({ compressionLevel: 9, adaptiveFiltering: false, progressive: false })
    .toBuffer()
  await fs.mkdir(outputDir, { recursive: true })
  await sharp(lowResPng)
    .resize({
      width: SPRITE_PET_ATLAS_WIDTH,
      height: SPRITE_PET_ATLAS_HEIGHT,
      kernel: sharp.kernel.nearest,
    })
    .png({ compressionLevel: 9, adaptiveFiltering: false, progressive: false })
    .toFile(path.join(outputDir, 'spritesheet.png'))
  await fs.writeFile(
    path.join(outputDir, 'pet.json'),
    `${JSON.stringify(buildManifest({ id, displayName: options.displayName }), null, 2)}\n`,
    'utf8',
  )
  await fs.writeFile(
    path.join(outputDir, 'README.md'),
    buildReadme({ displayName: options.displayName, id, colors, accessory: options.accessory }),
    'utf8',
  )
  await readSpritePetPackage(path.join(outputDir, 'pet.json'))

  console.log('Codex-style mascot pet generated')
  console.log(`- output: ${outputDir}`)
  console.log(`- id: ${id}`)
  console.log(`- displayName: ${options.displayName}`)
  console.log('- atlas: spritesheet.png')
  console.log('- private Codex code/assets copied: false')
} catch (error) {
  console.error(`Codex-style mascot generation failed: ${error?.message ?? String(error)}`)
  process.exit(1)
}
