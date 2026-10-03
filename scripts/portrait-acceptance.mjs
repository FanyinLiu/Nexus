/**
 * Explicit local frozen-fixture acceptance entry; no download or fixture discovery.
 * Exit 0 means expected verdicts matched, 1 means mismatch, and 2 means not run.
 * Without --execute the report validates the freeze only, never claims acceptance.
 */

import fs from 'node:fs/promises'
import { runPortraitAcceptance } from './lib/portrait-acceptance.mjs'

function parseArgs(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--execute') options.execute = true
    else if (['--manifest', '--models-dir', '--output'].includes(arg)) {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error('arguments_invalid')
      options[{ '--manifest': 'manifestPath', '--models-dir': 'modelsDirectory', '--output': 'outputPath' }[arg]] = value
    } else throw new Error('arguments_invalid')
  }
  return options
}

try {
  const options = parseArgs(process.argv.slice(2))
  const report = await runPortraitAcceptance(options)
  const json = `${JSON.stringify(report, null, 2)}\n`
  if (options.outputPath) {
    // Refuse to overwrite an existing fixture, manifest or report.
    await fs.writeFile(options.outputPath, json, { flag: 'wx', mode: 0o600 })
  }
  process.stdout.write(json)
  process.exitCode = report.status === 'passed' ? 0 : report.status === 'failed' ? 1 : 2
} catch {
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, status: 'not_run', reasonCode: 'arguments_or_output_invalid' })}\n`)
  process.exitCode = 2
}
