#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import {
  SPRITE_PET_MAX_BYTES,
  readSpritePetPackage,
} from '../electron/services/spritePetPackage.js'
import {
  parseCodexPetOrgPage,
} from '../electron/services/codexPetGallery.js'

const DEFAULT_OUTPUT_DIR = 'public/pets'
const CODEX_PET_BASE_URL = 'https://codex-pet.com/pets/'
const CODEX_PET_ORG_BASE_URL_LOCAL = 'https://codex-pet.org/pets/'

function printUsage() {
  console.error([
    'Usage: npm run pet:import-gallery -- <codex-pet-slug-or-url> [options]',
    '',
    'Downloads a Codex-compatible community pet page into a local Nexus sprite pet package.',
    '',
    'Options:',
    '  --output-dir <dir>       Directory for bundled pets. Default: public/pets',
    '  --id <id>                Override package id.',
    '  --display-name <name>    Override display name.',
    '  --description <text>     Override description.',
    '  --force                  Replace an existing target package.',
  ].join('\n'))
}

function parseArgs(argv) {
  const options = {
    input: '',
    outputDir: DEFAULT_OUTPUT_DIR,
    id: '',
    displayName: '',
    description: '',
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

    if (arg === '--output-dir' || arg === '--id' || arg === '--display-name' || arg === '--description') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error(`${arg} requires a value.`)
      }
      index += 1

      if (arg === '--output-dir') options.outputDir = value
      if (arg === '--id') options.id = value
      if (arg === '--display-name') options.displayName = value
      if (arg === '--description') options.description = value
      continue
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`)
    }

    if (options.input) {
      throw new Error(`Unexpected extra argument: ${arg}`)
    }

    options.input = arg
  }

  return options
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

function isHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function resolvePetPageUrl(input) {
  if (isHttpUrl(input)) {
    return input
  }

  const slug = slugifySpritePetId(input)
  if (!slug || slug !== input.trim().toLowerCase()) {
    throw new Error('Codex pet gallery slug must contain only letters, numbers, dashes, or underscores.')
  }

  return `${CODEX_PET_BASE_URL}${slug}`
}

function resolvePetPageUrls(input) {
  if (!isHttpUrl(input)) {
    const pageUrl = resolvePetPageUrl(input)
    const slug = slugifySpritePetId(input)
    return [pageUrl, `${CODEX_PET_ORG_BASE_URL_LOCAL}${slug}`]
  }

  const resolved = new URL(input)
  const pageUrl = resolved.toString()
  const pathParts = resolved.pathname.split('/').filter(Boolean)
  const petIndex = pathParts.indexOf('pets')
  const isCodexPetsComDetail = (resolved.hostname === 'codex-pet.com' || resolved.hostname.endsWith('.codex-pet.com'))
    && petIndex >= 0
    && Boolean(pathParts[petIndex + 1])

  if (!isCodexPetsComDetail) {
    return [pageUrl]
  }

  const slug = slugifySpritePetId(pathParts[petIndex + 1])
  const codexPetOrgUrl = `${CODEX_PET_ORG_BASE_URL_LOCAL}${slug}/`

  return [pageUrl, codexPetOrgUrl]
}

function decodeJsString(value) {
  try {
    return JSON.parse(`"${value}"`)
  } catch {
    return value.replaceAll('\\"', '"').replaceAll('\\\\', '\\')
  }
}

function matchJsString(source, key, fromIndex = 0) {
  const expression = new RegExp(`${key}:"((?:\\\\.|[^"\\\\])*)"`, 'u')
  const match = expression.exec(source.slice(fromIndex))
  return match ? decodeJsString(match[1]) : ''
}

function inferSpriteExtension(spriteUrl, declaredExtension) {
  const declared = String(declaredExtension ?? '').trim().toLowerCase()
  if (declared === 'png' || declared === 'webp') {
    return declared
  }

  const pathname = new URL(spriteUrl).pathname.toLowerCase()
  if (pathname.endsWith('.png')) return 'png'
  if (pathname.endsWith('.webp')) return 'webp'

  throw new Error('Could not infer spritesheet extension; expected PNG or WebP.')
}

function parsePetPage(html, pageUrl) {
  if (isCodexPetOrgDetailUrl(pageUrl)) {
    return parseCodexPetOrgPage(html, pageUrl)
  }

  const petIndex = html.indexOf('pet:$R')
  const searchIndex = petIndex >= 0 ? petIndex : 0
  const petJsonIndex = html.indexOf('petJson', searchIndex)
  const spriteUrl = matchJsString(html, 'spritesheetUrl', searchIndex)

  if (!spriteUrl || !isHttpUrl(spriteUrl)) {
    throw new Error(`Could not find a valid spritesheetUrl in ${pageUrl}.`)
  }

  const declaredExtension = matchJsString(html, 'spritesheetExt', searchIndex)
  const slug = matchJsString(html, 'slug', searchIndex)
  const displayName = matchJsString(html, 'displayName', searchIndex)
  const description = matchJsString(html, 'description', searchIndex)
  const manifestId = petJsonIndex >= 0 ? matchJsString(html, 'id', petJsonIndex) : ''

  return {
    id: manifestId || slug || path.basename(new URL(pageUrl).pathname),
    displayName: displayName || manifestId || slug || 'Codex Pet',
    description,
    spriteUrl,
    spriteExtension: inferSpriteExtension(spriteUrl, declaredExtension),
    sourcePageUrl: pageUrl,
  }
}

function isCodexPetOrgDetailUrl(input) {
  if (!isHttpUrl(input)) {
    return false
  }

  const url = new URL(input)
  const pathParts = url.pathname.split('/').filter(Boolean)
  const petIndex = pathParts.indexOf('pets')
  return (url.hostname === 'codex-pet.org' || url.hostname.endsWith('.codex-pet.org'))
    && petIndex >= 0
    && Boolean(pathParts[petIndex + 1])
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function fetchText(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`)
  }
  return response.text()
}

async function fetchBytes(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`)
  }

  const contentLength = Number.parseInt(response.headers.get('content-length') ?? '0', 10)
  if (Number.isFinite(contentLength) && contentLength > SPRITE_PET_MAX_BYTES) {
    throw new Error(`Spritesheet is too large: ${contentLength} bytes.`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > SPRITE_PET_MAX_BYTES) {
    throw new Error(`Spritesheet is too large: ${buffer.length} bytes.`)
  }

  return buffer
}

try {
  const options = parseArgs(process.argv.slice(2))

  if (options.help || !options.input) {
    printUsage()
    process.exit(options.help ? 0 : 1)
  }

  const candidateUrls = resolvePetPageUrls(options.input)
  let petPage = null
  let lastError = null
  for (const pageUrl of candidateUrls) {
    try {
      petPage = parsePetPage(await fetchText(pageUrl), pageUrl)
      break
    } catch (error) {
      lastError = error
    }
  }

  if (!petPage) {
    throw new Error(`Could not import ${options.input}: ${lastError?.message ?? 'unknown error'}`)
  }

  const packageId = slugifySpritePetId(options.id || petPage.id || petPage.displayName)
  const outputRoot = path.resolve(process.cwd(), options.outputDir)
  const targetDirectory = path.join(outputRoot, packageId)

  if (await pathExists(targetDirectory)) {
    if (!options.force) {
      throw new Error(`Target package already exists: ${targetDirectory}. Re-run with --force to replace it.`)
    }
    await fs.rm(targetDirectory, { recursive: true, force: true })
  }

  const targetSpriteName = `spritesheet.${petPage.spriteExtension}`
  const targetSpritePath = path.join(targetDirectory, targetSpriteName)
  const targetManifestPath = path.join(targetDirectory, 'pet.json')
  const manifest = {
    id: packageId,
    displayName: String(options.displayName || petPage.displayName || packageId).trim(),
    description: String(options.description || petPage.description || '').trim(),
    spritesheetPath: targetSpriteName,
  }

  await fs.mkdir(targetDirectory, { recursive: true })
  await fs.writeFile(targetSpritePath, await fetchBytes(petPage.spriteUrl))
  await fs.writeFile(targetManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await readSpritePetPackage(targetManifestPath)

  console.log('Codex pet gallery package imported')
  console.log(`- source: ${petPage.sourcePageUrl}`)
  console.log(`- sprite: ${petPage.spriteUrl}`)
  console.log(`- id: ${manifest.id}`)
  console.log(`- displayName: ${manifest.displayName}`)
  if (manifest.description) {
    console.log(`- description: ${manifest.description}`)
  }
  console.log(`- target: ${targetDirectory}`)
  console.log(`- spritesheet: ${targetSpriteName}`)
  console.log('- private Codex code/assets copied: false')
} catch (error) {
  console.error(`Codex pet gallery import failed: ${error?.message ?? String(error)}`)
  process.exit(1)
}
