/**
 * Stryker mutation-testing configuration.
 *
 * Scoped to the v0.3.1-beta.5 pure-function core. Mutates each module's
 * source, runs the dedicated tests + properties, and reports survivors —
 * mutations that pass tests are gaps in coverage. Goal: a high mutation
 * score (>80%) on the modules that drive companion behaviour.
 *
 * Uses the `command` runner because the project's tests run via Node's
 * built-in `node --test` rather than Jest / Mocha. Each per-mutant run
 * boots Node fresh, but tinybench-level cost is fine for these small
 * pure modules.
 */
export default {
  packageManager: 'npm',
  reporters: ['html', 'clear-text', 'progress'],
  testRunner: 'command',
  commandRunner: {
    // Run only the property tests + the targeted module tests on each
    // mutant. This shrinks the per-mutant runtime from "full 1130 tests"
    // down to ~80 tests that actually exercise the mutated code.
    command:
      'node --experimental-strip-types --test '
      + 'tests/properties.test.ts '
      + 'tests/affect-guidance.test.ts '
      + 'tests/affect-dynamics.test.ts '
      + 'tests/coregulation.test.ts '
      + 'tests/guidance-analysis.test.ts '
      + 'tests/mood-map-binning.test.ts '
      + 'tests/rupture-detection.test.ts '
      + 'tests/open-arc.test.ts '
      + 'tests/yearbook.test.ts '
      + 'tests/letter-export.test.ts',
  },
  mutate: [
    'src/features/autonomy/affectGuidance.ts',
    'src/features/autonomy/affectDynamics.ts',
    'src/features/autonomy/coregulation.ts',
    'src/features/autonomy/guidanceAnalysis.ts',
    'src/features/autonomy/moodMapBinning.ts',
    'src/features/autonomy/ruptureDetection.ts',
    'src/features/autonomy/repairGuidance.ts',
    'src/features/arc/openArcPolicy.ts',
    'src/features/arc/openArcDelivery.ts',
    'src/features/letter/letterExport.ts',
    'src/features/yearbook/yearbookAggregator.ts',
    'src/features/yearbook/yearbookRender.ts',
  ],
  // Bump time budget — node --test boots fresh per run.
  timeoutMS: 15000,
  timeoutFactor: 2,
  // Skip mutations in i18n prose tables — string mutations there have no
  // testable behavioural impact (the prose just changes one character;
  // tests assert structure, not exact wording).
  ignorePatterns: ['node_modules', 'release', 'dist'],
  concurrency: 4,
  thresholds: {
    high: 80,
    low: 60,
    break: null,
  },
}
