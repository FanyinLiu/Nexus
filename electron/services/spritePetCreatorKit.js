import fs from 'node:fs/promises'
import path from 'node:path'
import {
  SPRITE_PET_ATLAS_HEIGHT,
  SPRITE_PET_ATLAS_WIDTH,
  SPRITE_PET_CELL_HEIGHT,
  SPRITE_PET_CELL_WIDTH,
  SPRITE_PET_COLUMNS,
  SPRITE_PET_ROW_CONTRACT,
  SPRITE_PET_ROWS,
  formatSpritePetDisplayName,
} from './spritePetPackage.js'

const DEFAULT_OUTPUT_DIR = 'output/pet-creator-kits'

const STATE_NOTES = {
  idle: 'quiet breathing, tiny blink, slight body bob only; no walking, waving, jumping, talking, or new props',
  'running-right': 'directional locomotion to the right through body and tiny limb movement only; no speed lines, dust, shadows, trails, or smears',
  'running-left': 'directional locomotion to the left through body and tiny limb movement only; no speed lines, dust, shadows, trails, or smears',
  waving: 'wave through paw pose only; no wave marks, motion arcs, sparkles, punctuation, or symbols',
  jumping: 'vertical body position change only; no floor shadow, dust, landing marks, bounce pads, or impact bursts',
  failed: 'small attached hard-edged tears, smoke, or stars may touch the pet; no detached symbols, red X marks, loose drops, or separate smoke clouds',
  waiting: 'patient standby loop with subtle face or body changes; no large gestures, UI symbols, or new props',
  running: 'busy in-progress work loop; not literal foot-running or sprinting; no treadmill, raised knees, speed marks, or travel',
  review: 'focused review through lean, blink, eyes, head tilt, or paw position; no magnifying glass, papers, code, UI, punctuation, or symbols unless already part of the pet identity',
}

const STYLE_SAMPLE_LINKS = [
  {
    name: 'Solid Box',
    source: 'codex-pet.org',
    url: 'https://codex-pet.org/pets/solid-box/',
    learn: [
      'box-simple silhouette that still reads inside a 192x208 cell',
      'state changes stay small and row-based instead of becoming character-sheet poses',
      'transparent package assets can be inspected without copying the art into this kit',
    ],
  },
  {
    name: 'Kafu',
    source: 'codex-pet.org',
    url: 'https://codex-pet.org/pets/kafu/',
    learn: [
      'anime-inspired identity simplified into a tiny pet-scale mascot',
      'face and color identity carry the character more than body detail',
      'useful reference for avoiding full-height anime key art',
    ],
  },
  {
    name: 'Pixel Coder',
    source: 'CodexPets.net',
    url: 'https://codexpets.net/pets/pixel-coder',
    learn: [
      'tool-like identity kept as a compact desktop companion',
      'good comparison point for package naming and preview expectations',
      'useful reference for checking whether an imported pet still feels like a Codex pet',
    ],
  },
]

function slugifySpritePetId(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/[\\/]+/g, '-')
    .replace(/\.[^.]+$/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()

  return normalized || 'sprite-pet'
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildBasePrompt({ displayName, concept, styleNotes }) {
  const conceptLine = concept
    ? `Pet concept: ${concept}.`
    : `Pet concept: infer a compact friendly mascot for ${displayName}.`
  const styleLine = styleNotes
    ? `Extra style notes: ${styleNotes}.`
    : ''

  return [
    `Create the canonical base reference for a Codex-compatible digital pet named ${displayName}.`,
    conceptLine,
    styleLine,
    '',
    'Style contract:',
    '- small pixel-art-adjacent mascot, not Live2D, not anime key art, not a full-body human character',
    '- compact chibi proportions: large head/body mass, tiny arms, tiny legs, chunky readable silhouette',
    '- thick dark 1-2 px outline, visible stepped/pixel edges, limited palette, flat cel shading',
    '- simple expressive face readable inside a 192x208 frame',
    '- transparent background or a clean flat chroma-key background that is not used anywhere in the pet',
    '- no scenery, UI panels, text, speech bubbles, thought bubbles, shadows, glow, aura, gradients, motion trails, detached effects, or guide marks',
    '- keep accessories tiny, attached to the pet, and secondary to the mascot silhouette',
    '',
    'Output one clean centered base pet image only. This base becomes the visual source of truth for every animation row.',
  ].filter(Boolean).join('\n')
}

function buildRowPrompt({ displayName, concept, row }) {
  const durations = row.durationsMs.join(', ')
  const stateNote = STATE_NOTES[row.state] ?? 'use restrained Codex digital pet motion only'
  const conceptLine = concept ? `Preserve this pet concept: ${concept}.` : ''
  const layoutGuide = `references/layout-guides/${row.row}-${row.state}-layout.svg`

  return [
    `Create the ${row.state} animation row for the Codex-compatible digital pet ${displayName}.`,
    conceptLine,
    '',
    'Use the canonical base pet image as identity reference. Do not redesign the pet.',
    `If your image workflow supports reference images, use ${layoutGuide} only as a construction guide for frame count, spacing, and safe padding.`,
    `Generate exactly ${row.frameCount} separated poses for row ${row.row} (${row.state}).`,
    `Each pose is intended for a ${SPRITE_PET_CELL_WIDTH}x${SPRITE_PET_CELL_HEIGHT} frame; keep every pose centered with safe transparent padding.`,
    `Animation timing in Nexus/Codex-compatible runtimes: ${durations} ms.`,
    `State behavior: ${stateNote}.`,
    '',
    'Mandatory style and cleanup rules:',
    '- same species, face, palette, outline weight, silhouette, prop design, and proportions as the base pet',
    '- small pixel-art-adjacent mascot style with flat cel shading and hard readable edges',
    '- transparent background or clean flat chroma-key background only',
    '- no visible grid, frame numbers, labels, UI, code, scenery, white background, black background, checkerboard, or guide marks',
    '- no speed lines, wave marks, motion arcs, afterimages, blur, smears, dust, floor shadows, drop shadows, glow, halo, aura, or loose floating symbols',
    '- allowed effects only when attached to or overlapping the pet silhouette and small enough to read at 192x208',
    '',
    'Return only the row strip art. Leave unused future atlas cells transparent during final assembly.',
  ].filter(Boolean).join('\n')
}

function buildRowLayoutGuideSvg({ displayName, row }) {
  const width = row.frameCount * SPRITE_PET_CELL_WIDTH
  const height = SPRITE_PET_CELL_HEIGHT
  const safePadding = 16
  const centerY = Math.round(height / 2)
  const frameGuides = Array.from({ length: row.frameCount }, (_, frame) => {
    const x = frame * SPRITE_PET_CELL_WIDTH
    const centerX = x + Math.round(SPRITE_PET_CELL_WIDTH / 2)
    return [
      `<g class="frame" transform="translate(${x} 0)">`,
      `  <rect x="0.5" y="0.5" width="${SPRITE_PET_CELL_WIDTH - 1}" height="${SPRITE_PET_CELL_HEIGHT - 1}" rx="0" />`,
      `  <rect class="safe" x="${safePadding + 0.5}" y="${safePadding + 0.5}" width="${SPRITE_PET_CELL_WIDTH - (safePadding * 2) - 1}" height="${SPRITE_PET_CELL_HEIGHT - (safePadding * 2) - 1}" rx="0" />`,
      `  <line class="center" x1="${Math.round(SPRITE_PET_CELL_WIDTH / 2)}" y1="${safePadding}" x2="${Math.round(SPRITE_PET_CELL_WIDTH / 2)}" y2="${height - safePadding}" />`,
      `  <line class="center" x1="${safePadding}" y1="${centerY}" x2="${SPRITE_PET_CELL_WIDTH - safePadding}" y2="${centerY}" />`,
      `  <text class="index" x="8" y="18">frame ${frame + 1}</text>`,
      '</g>',
      `<circle class="dot" cx="${centerX}" cy="${centerY}" r="3" />`,
    ].join('\n')
  }).join('\n')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(displayName)} row ${row.row} ${row.state} construction guide">
  <title>${escapeXml(displayName)} ${row.state} construction guide</title>
  <desc>Layout-only construction guide for row ${row.row}: ${row.frameCount} frames, each ${SPRITE_PET_CELL_WIDTH}x${SPRITE_PET_CELL_HEIGHT}. Do not copy visible guide marks into generated art.</desc>
  <defs>
    <pattern id="checker" width="16" height="16" patternUnits="userSpaceOnUse">
      <rect width="16" height="16" fill="#ffffff" />
      <rect width="8" height="8" fill="#eef2f7" />
      <rect x="8" y="8" width="8" height="8" fill="#eef2f7" />
    </pattern>
  </defs>
  <style>
    .frame { fill: none; stroke: #334155; stroke-width: 1; }
    .safe { fill: none; stroke: #22c55e; stroke-width: 1; stroke-dasharray: 6 5; }
    .center { stroke: #2563eb; stroke-width: 1; stroke-dasharray: 4 6; }
    .dot { fill: #2563eb; opacity: 0.7; }
    .label { fill: #0f172a; font: 700 13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .index { fill: #475569; font: 10px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .note { fill: #475569; font: 11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  </style>
  <rect width="${width}" height="${height}" fill="url(#checker)" />
  ${frameGuides}
  <text class="label" x="10" y="${height - 14}">row ${row.row} - ${escapeXml(row.state)} - ${row.frameCount} frames - ${SPRITE_PET_CELL_WIDTH}x${SPRITE_PET_CELL_HEIGHT}</text>
  <text class="note" x="${Math.max(10, width - 438)}" y="${height - 14}">construction guide only; output art must be transparent and mark-free</text>
</svg>`
}

function buildAnimationRowsMarkdown() {
  const rows = SPRITE_PET_ROW_CONTRACT.map((row) => (
    `| ${row.row} | ${row.state} | ${row.frameCount} | ${row.durationsMs.join(', ')} |`
  )).join('\n')

  return `# Animation Rows

The final Codex-compatible atlas is exactly ${SPRITE_PET_ATLAS_WIDTH}x${SPRITE_PET_ATLAS_HEIGHT}.

- ${SPRITE_PET_COLUMNS} columns
- ${SPRITE_PET_ROWS} rows
- ${SPRITE_PET_CELL_WIDTH}x${SPRITE_PET_CELL_HEIGHT} pixels per frame
- used cells contain the pet sprite
- unused cells are fully transparent

| Row | State | Frames | Durations ms |
| --- | --- | ---: | --- |
${rows}
`
}

function buildQualityChecklist() {
  return `# Codex Pet QA Checklist

Reject the pet if any item below fails.

- Atlas is PNG or WebP, exactly ${SPRITE_PET_ATLAS_WIDTH}x${SPRITE_PET_ATLAS_HEIGHT}.
- Frame cells are exactly ${SPRITE_PET_CELL_WIDTH}x${SPRITE_PET_CELL_HEIGHT}.
- Row and frame counts match animation-rows.md.
- Unused cells are fully transparent.
- Every used frame contains the same pet identity: species, face, palette, outline, silhouette, and prop design stay consistent.
- The pet reads as a compact Codex-style mascot, not Live2D, anime key art, a realistic render, or a full-body character illustration.
- No visible grid, labels, text, UI, code, scenery, checkerboard, white background, black background, shadows, glow, speed lines, wave marks, dust, motion trails, detached effects, or stray pixels.
- Direction rows move through pose changes only; non-directional running looks like busy work, not literal sprinting.

Validate and preview in Nexus:

\`\`\`bash
npm run pet:validate -- ./path/to/pet-folder
npm run pet:audit -- ./path/to/pet-folder --strict
npm run pet:preview -- ./path/to/pet-folder
\`\`\`
`
}

function buildStyleSamplesMarkdown() {
  const samples = STYLE_SAMPLE_LINKS.map((sample) => {
    const learn = sample.learn.map((item) => `  - ${item}`).join('\n')
    return `- ${sample.name} (${sample.source}): ${sample.url}\n${learn}`
  }).join('\n')

  return `# Codex Pet Style Samples

These are reference links only. This creator kit does not bundle, mirror, or redistribute community artwork.

Study these pets before generating row art:

${samples}

What to learn from the samples:

- The pet is a tiny desktop mascot first, not a full-body anime sprite, Live2D model, or polished illustration.
- The silhouette stays chunky and readable inside each ${SPRITE_PET_CELL_WIDTH}x${SPRITE_PET_CELL_HEIGHT} cell.
- Motion is row-based and restrained: blink, bob, lean, tiny limb pose, small vertical movement.
- Effects are rare, hard-edged, attached to the pet, and do not create detached visual clutter.
- Unused atlas cells stay fully transparent.

Use these links to calibrate the feeling, then make original or properly licensed art for this package.
`
}

function buildStyleSamplesJson() {
  return {
    sampleLinksOnly: true,
    thirdPartyArtBundled: false,
    purpose: 'Reference links for studying Codex-style pet proportions, row motion, and package expectations.',
    samples: STYLE_SAMPLE_LINKS,
  }
}

function buildReadme({ packageId, displayName, description, concept }) {
  const conceptText = concept || 'Use your own compact mascot idea or reference image.'

  return `# ${displayName} Codex Pet Creator Kit

This folder is a clean-room creator kit for making a Codex-compatible sprite pet. It contains prompts and checks, not generated art.

## Start Here

1. Read \`references/animation-rows.md\`.
2. Open \`references/style-samples.md\` and study the linked Codex-style pets before drawing or generating art.
3. Generate a base mascot from \`prompts/base.md\`.
4. Use that base image as the identity reference for every prompt in \`prompts/rows/\`.
5. Use \`references/layout-guides/\` only as construction guides for frame count, spacing, and safe padding.
6. Save generated row-strip images into \`source-rows/\` using the filenames listed there.
7. Assemble the finished art into a Codex-compatible package:

\`\`\`bash
npm run pet:assemble-kit -- ./path/to/${packageId}
\`\`\`

8. The final package is written as:

\`\`\`text
final-package/
  pet.json
  spritesheet.png
  assembly-report.json
  visual-audit.json
\`\`\`

9. Import the folder or ZIP into Nexus.

## Pet Brief

- id: ${packageId}
- displayName: ${displayName}
- description: ${description}
- concept: ${conceptText}

## Keep The Codex Feeling

The target is the Codex desktop pet model: a small pixel-art-adjacent animated mascot with restrained row-based motion. Do not turn it into Live2D, an anime character sheet, a polished illustration, or a human full-body sprite.

Use \`references/style-samples.md\` only to study proportions and movement. It contains links, not bundled third-party art.

Run the QA checklist in \`references/quality-checklist.md\` before importing.
`
}

function buildSourceRowsReadme() {
  const rows = SPRITE_PET_ROW_CONTRACT.map((row) => (
    `- \`${row.row}-${row.state}.png\` or \`${row.row}-${row.state}.webp\` - ${row.frameCount} poses for row ${row.row}`
  )).join('\n')

  return `# Source Rows

Put generated row-strip images in this folder before assembling the pet.

Accepted filenames:

${rows}

Each row strip should contain only the requested poses on a transparent or clean flat background. Nexus will resize each strip into ${SPRITE_PET_CELL_WIDTH}x${SPRITE_PET_CELL_HEIGHT} frame cells and place it in the final ${SPRITE_PET_COLUMNS}x${SPRITE_PET_ROWS} atlas. It will not invent missing row art.

Use the matching files in \`../references/layout-guides/\` only as construction references. The finished row images must not include visible guide boxes, labels, checkerboard backgrounds, center marks, or safe-zone outlines.
`
}

function buildCreatorBrief({ packageId, displayName, description, concept, styleNotes }) {
  return {
    id: packageId,
    displayName,
    description,
    concept,
    styleNotes,
    contract: {
      atlas: {
        columns: SPRITE_PET_COLUMNS,
        rows: SPRITE_PET_ROWS,
        width: SPRITE_PET_ATLAS_WIDTH,
        height: SPRITE_PET_ATLAS_HEIGHT,
        cellWidth: SPRITE_PET_CELL_WIDTH,
        cellHeight: SPRITE_PET_CELL_HEIGHT,
      },
      rowContract: SPRITE_PET_ROW_CONTRACT,
    },
    styleSamples: {
      sampleLinksOnly: true,
      thirdPartyArtBundled: false,
      files: [
        'references/style-samples.md',
        'references/style-samples.json',
      ],
      sources: STYLE_SAMPLE_LINKS.map(({ name, source, url }) => ({ name, source, url })),
    },
    workflow: [
      'study references/style-samples.md for Codex-style proportions and restrained row motion',
      'generate base mascot from prompts/base.md',
      'use the base as identity reference for every row prompt',
      'use references/layout-guides only as invisible construction guides',
      'assemble the final 8x9 atlas with transparent unused cells',
      'validate, audit, preview, then import into Nexus',
    ],
    provenance: {
      privateCodexCodeOrAssetsCopied: false,
      privateCodexBuiltInAssetsCopied: false,
      thirdPartyArtBundled: false,
      sampleLinksOnly: true,
      expectedArtSource: 'user-generated, user-owned, or explicitly licensed art',
    },
  }
}

function buildManifestTemplate({ packageId, displayName, description }) {
  return {
    id: packageId,
    displayName,
    description,
    spritesheetPath: 'spritesheet.webp',
  }
}

function withTrailingNewline(value) {
  return String(value).endsWith('\n') ? String(value) : `${value}\n`
}

async function createSpritePetCreatorKit({
  targetDirectory,
  id = '',
  displayName = '',
  description = '',
  concept = '',
  styleNotes = '',
  force = false,
} = {}) {
  const packageId = slugifySpritePetId(id || displayName || concept || 'sprite-pet')
  const normalizedDisplayName = normalizeText(displayName || formatSpritePetDisplayName(packageId))
  const normalizedDescription = normalizeText(description || `Creator kit for ${normalizedDisplayName}, a Codex-compatible sprite pet.`)
  const normalizedConcept = normalizeText(concept)
  const normalizedStyleNotes = normalizeText(styleNotes)
  const outputDirectory = path.resolve(targetDirectory || path.join(DEFAULT_OUTPUT_DIR, packageId))

  if (await pathExists(outputDirectory)) {
    if (!force) {
      throw new Error(`Creator kit already exists: ${outputDirectory}. Re-run with --force to replace it.`)
    }
    await fs.rm(outputDirectory, { recursive: true, force: true })
  }

  await fs.mkdir(path.join(outputDirectory, 'prompts', 'rows'), { recursive: true })
  await fs.mkdir(path.join(outputDirectory, 'references'), { recursive: true })
  await fs.mkdir(path.join(outputDirectory, 'references', 'layout-guides'), { recursive: true })
  await fs.mkdir(path.join(outputDirectory, 'package-template'), { recursive: true })
  await fs.mkdir(path.join(outputDirectory, 'source-rows'), { recursive: true })

  const common = {
    packageId,
    displayName: normalizedDisplayName,
    description: normalizedDescription,
    concept: normalizedConcept,
    styleNotes: normalizedStyleNotes,
  }

  await fs.writeFile(
    path.join(outputDirectory, 'creator-brief.json'),
    `${JSON.stringify(buildCreatorBrief(common), null, 2)}\n`,
    'utf8',
  )
  await fs.writeFile(path.join(outputDirectory, 'README.md'), withTrailingNewline(buildReadme(common)), 'utf8')
  await fs.writeFile(path.join(outputDirectory, 'prompts', 'base.md'), withTrailingNewline(buildBasePrompt(common)), 'utf8')
  await fs.writeFile(path.join(outputDirectory, 'references', 'animation-rows.md'), withTrailingNewline(buildAnimationRowsMarkdown()), 'utf8')
  await fs.writeFile(path.join(outputDirectory, 'references', 'style-samples.md'), withTrailingNewline(buildStyleSamplesMarkdown()), 'utf8')
  await fs.writeFile(
    path.join(outputDirectory, 'references', 'style-samples.json'),
    `${JSON.stringify(buildStyleSamplesJson(), null, 2)}\n`,
    'utf8',
  )
  await fs.writeFile(path.join(outputDirectory, 'references', 'quality-checklist.md'), withTrailingNewline(buildQualityChecklist()), 'utf8')
  await fs.writeFile(path.join(outputDirectory, 'source-rows', 'README.md'), withTrailingNewline(buildSourceRowsReadme()), 'utf8')
  await fs.writeFile(
    path.join(outputDirectory, 'package-template', 'pet.json'),
    `${JSON.stringify(buildManifestTemplate(common), null, 2)}\n`,
    'utf8',
  )

  for (const row of SPRITE_PET_ROW_CONTRACT) {
    await fs.writeFile(
      path.join(outputDirectory, 'prompts', 'rows', `${row.row}-${row.state}.md`),
      withTrailingNewline(buildRowPrompt({ ...common, row })),
      'utf8',
    )
    await fs.writeFile(
      path.join(outputDirectory, 'references', 'layout-guides', `${row.row}-${row.state}-layout.svg`),
      withTrailingNewline(buildRowLayoutGuideSvg({ ...common, row })),
      'utf8',
    )
  }

  return {
    id: packageId,
    displayName: normalizedDisplayName,
    directoryPath: outputDirectory,
    sourceRowsDirectory: path.join(outputDirectory, 'source-rows'),
    layoutGuidesDirectory: path.join(outputDirectory, 'references', 'layout-guides'),
    message: `已创建 ${normalizedDisplayName} 的 Codex 宠物制作包：${outputDirectory}`,
  }
}

export {
  DEFAULT_OUTPUT_DIR,
  slugifySpritePetId,
  createSpritePetCreatorKit,
}
