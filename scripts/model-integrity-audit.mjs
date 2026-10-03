#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MODEL_CATALOG } from '../electron/services/modelDefinitions.js'
import { PORTRAIT_MODEL_CATALOG, PORTRAIT_MODEL_RELEASE } from '../shared/portraitModels.js'
import { validateModelDownloadUrl, validateModelIntegrity } from '../electron/services/modelDownloadSecurity.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const REQUIRED_DOWNLOADER_PHRASES = [
  'validateModelDownloadUrl',
  'resolveModelDownloadRedirect',
  'validateModelIntegrity',
  'validateModelArchiveListing',
  '.partial-${process.pid}-${Date.now()}',
  'replaceDirectory',
  '.nexus-model.json',
]

export function inspectModelCatalog(catalog) {
  const errors = []
  for (const model of catalog) {
    try {
      if (model.kind === 'archive') {
        validateModelDownloadUrl(model.githubArchive)
        validateModelIntegrity(model.integrity?.archive)
      } else if (model.kind === 'standalone') {
        for (const url of model.standalone?.urls ?? []) validateModelDownloadUrl(url)
        validateModelIntegrity(model.standalone?.integrity)
      } else if (model.kind === 'files') {
        if (!/^[a-f0-9]{40}$/.test(String(model.revision ?? ''))) {
          throw new Error('Hugging Face revision must be a full commit hash')
        }
        for (const file of model.files ?? []) validateModelIntegrity(model.integrity?.files?.[file])
      } else {
        throw new Error('Unknown model kind')
      }
    } catch (error) {
      errors.push({ modelId: model.id, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return errors
}

const PORTRAIT_DOWNLOADER_PHRASES = [
  'validateModelDownloadUrl',
  'resolveModelDownloadRedirect',
  'validateModelIntegrity',
  "redirect: 'manual'",
  'RELEASE_UNPUBLISHED',
]

/**
 * Portrait models: pinned to the Nexus release, size + SHA-256, a commit-pinned
 * upstream source, and a licence the app can show.
 */
export function inspectPortraitModelCatalog(catalog = PORTRAIT_MODEL_CATALOG, release = PORTRAIT_MODEL_RELEASE) {
  const errors = []
  for (const model of catalog) {
    try {
      validateModelDownloadUrl(model.url)
      validateModelIntegrity(model)
      if (model.url !== `${release.baseUrl}/${model.fileName}`) throw new Error('Portrait model URL must point at the pinned release asset')
      if (!/^[a-f0-9]{40}$/.test(String(model.source?.revision ?? ''))) throw new Error('Portrait model source must be pinned to a full commit hash')
      if (!model.license?.spdx || !/^https:\/\//.test(String(model.license?.url ?? ''))) throw new Error('Portrait model needs a licence id and URL')
      if (typeof model.trainingDataDocumented !== 'boolean') throw new Error('Portrait model must state whether training data is documented')
    } catch (error) {
      errors.push({ modelId: model.id, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return errors
}

export function buildModelIntegrityReport(root = ROOT, catalog = MODEL_CATALOG) {
  const catalogErrors = [...inspectModelCatalog(catalog), ...inspectPortraitModelCatalog()]
  const downloader = readFileSync(join(root, 'electron/services/modelDownloader.js'), 'utf8')
  const portraitDownloader = readFileSync(join(root, 'electron/services/portraitGenerator/portraitModelDownloader.js'), 'utf8')
  const missingDownloaderPhrases = [
    ...REQUIRED_DOWNLOADER_PHRASES.filter((phrase) => !downloader.includes(phrase)),
    ...PORTRAIT_DOWNLOADER_PHRASES.filter((phrase) => !portraitDownloader.includes(phrase)).map((phrase) => `portrait: ${phrase}`),
  ]
  return {
    models: catalog.length + PORTRAIT_MODEL_CATALOG.length,
    errors: { catalogErrors, missingDownloaderPhrases },
    summary: {
      ok: catalogErrors.length === 0 && missingDownloaderPhrases.length === 0,
      errors: catalogErrors.length + missingDownloaderPhrases.length,
    },
  }
}

function main(argv) {
  const report = buildModelIntegrityReport()
  const json = argv.includes('--json') || argv.includes('--format=json')
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    console.log('Model integrity audit')
    console.log(`- models: ${report.models}`)
    console.log(`- catalog errors: ${report.errors.catalogErrors.length}`)
    console.log(`- downloader guard errors: ${report.errors.missingDownloaderPhrases.length}`)
    console.log(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  }
  if (!report.summary.ok) process.exit(1)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) main(process.argv.slice(2))
