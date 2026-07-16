export const REFERENCE_MANIFEST_FILE = 'docs/open-source-ui-reference-manifest.json'
export const OPEN_SOURCE_DOC = 'docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md'
export const CHAT_REVIEW_DOC = 'docs/CHAT_SURFACE_REFERENCE_REVIEW.md'
export const COMPOSER_REVIEW_DOC = 'docs/COMPOSER_SURFACE_REFERENCE_REVIEW.md'
export const IMAGE4_REVIEW_DOC = 'docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md'
export const SETTINGS_REVIEW_DOC = 'docs/SETTINGS_SURFACE_REFERENCE_REVIEW.md'
export const AGENT_ACTIVITY_REVIEW_DOC = 'docs/AGENT_ACTIVITY_SURFACE_REFERENCE_REVIEW.md'
export const IMAGE4_PATTERNS_DOC = 'docs/IMAGE4_UI_REFERENCE_PATTERNS.md'
export const DESIGN_CHECKLIST_DOC = 'docs/DESIGN_REVIEW_CHECKLIST.md'
export const PACKAGE_FILE = 'package.json'

export const REQUIRED_FILES = [
  REFERENCE_MANIFEST_FILE,
  OPEN_SOURCE_DOC,
  CHAT_REVIEW_DOC,
  COMPOSER_REVIEW_DOC,
  IMAGE4_REVIEW_DOC,
  SETTINGS_REVIEW_DOC,
  AGENT_ACTIVITY_REVIEW_DOC,
  IMAGE4_PATTERNS_DOC,
  DESIGN_CHECKLIST_DOC,
  PACKAGE_FILE,
]

export const REQUIRED_OPEN_SOURCE_SECTIONS = [
  'Verified References',
  'Remote Head Evidence',
  'Reference Evidence Snapshot',
  'Borrowing Rules',
  'Non-Open-Source Benchmarks',
  'Constraint Models',
  'Open-Source Pattern Matrix',
  'Reference Paradigm Axes',
  'Surface Acceptance Criteria',
  'Cross-Surface Behavior Rules',
  'Visual Rhythm And Density Model',
  'Surface Mapping',
  'Surface Coverage Matrix',
  'Decision Matrix',
  'CI Boundary',
  'Review Cadence',
]

export const REQUIRED_MANIFEST_POLICY = {
  staticSourceOnly: true,
  remoteChecked: false,
  liveNetworkGate: false,
  manualDesignGuard: true,
  borrowRule: 'constraints-not-skins',
}

export const REQUIRED_BORROWING_RULES = [
  'Borrow constraints, not skins.',
  'Borrow interaction hierarchy, not visual chrome.',
  'Borrow component behavior, not exact dimensions.',
  'Map every borrowed idea to a Nexus surface before applying it.',
  'Keep Image4 hard contracts narrow; use human review for chat/settings visual quality.',
]

export const REQUIRED_COMPOSER_REVIEW_PHRASES = [
  'composer = intent gateway + streaming controller',
  'composer = chat app center stage',
  'intent gateway and streaming controller',
  'Composer State Model',
  'Automatic Checks',
  'Human Review Checks',
  'Tool entry stays one interaction layer deep',
  'Streaming state does not introduce wrapper elevation',
]

export const REQUIRED_CHAT_REVIEW_PHRASES = [
  'chat = streaming feed + input dominance + tool boundary contract',
  'chat = primary app surface',
  'Chat State Model',
  'StreamLayer',
  'MessageLayer',
  'ToolLayer',
  'ComposerLayer',
  'Automatic Checks',
  'Human Review Checks',
  'Streaming uses append-only delta behavior',
]

export const REQUIRED_IMAGE4_REVIEW_PHRASES = [
  'image4 = companion semantic field',
  'image4 = dashboard widget panel',
  'Presence And Dial State Model',
  'presence and dial should be treated as one companion semantic field',
  'Companion State Contract',
  'one state organism',
  'system heartbeat indicator',
  'environment lens',
  'Dial | Stable layout anchor and environment lens.',
  'Presence | Non-layout-affecting state layer',
  'Automatic Checks',
  'Human Review Checks',
  'Do not use a horizontal multi-column layout inside dial.',
]

export const REQUIRED_SETTINGS_REVIEW_PHRASES = [
  'settings = companion behavior tuning surface',
  'settings = system configuration dashboard',
  'Settings State Model',
  'SettingRow primitive',
  'section graph, not cards',
  'Automatic Checks',
  'Human Review Checks',
  'Focus order remains predictable',
  'Form rows stay compact and repeated',
  'no Image4 rhythm variables',
]

export const REQUIRED_AGENT_ACTIVITY_REVIEW_PHRASES = [
  'companion activity, not agent execution',
  'context_available',
  'preparing_reply',
  'needs_confirmation',
  'coarse context',
  'explicit confirmation',
  'Automatic Checks',
  'Human Review Checks',
  'Agent Activity Contract',
  'Future Change Boundary',
]

export const REQUIRED_CROSS_DOC_PHRASES = [
  {
    file: OPEN_SOURCE_DOC,
    text: "It does not authorize cloning another product's layout, palette, spacing, or component skin.",
  },
  {
    file: OPEN_SOURCE_DOC,
    text: 'This is a pinned evidence snapshot, not a live CI dependency.',
  },
  {
    file: OPEN_SOURCE_DOC,
    text: '`docs/open-source-ui-reference-manifest.json` is the machine-readable source of truth',
  },
  {
    file: OPEN_SOURCE_DOC,
    text: 'Do not run live GitHub checks in CI or release gates.',
  },
  {
    file: OPEN_SOURCE_DOC,
    text: 'Manual refresh command pattern: run `git ls-remote <repository> <observed branch>`',
  },
  {
    file: OPEN_SOURCE_DOC,
    text: 'npm run ui:references:audit -- --reference-refresh-check',
  },
  {
    file: OPEN_SOURCE_DOC,
    text: 'docs/CHAT_SURFACE_REFERENCE_REVIEW.md',
  },
  {
    file: OPEN_SOURCE_DOC,
    text: 'docs/COMPOSER_SURFACE_REFERENCE_REVIEW.md',
  },
  {
    file: OPEN_SOURCE_DOC,
    text: 'docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md',
  },
  {
    file: CHAT_REVIEW_DOC,
    text: 'npm run ui:references:audit -- --surface=chat --pro-prompt',
  },
  {
    file: CHAT_REVIEW_DOC,
    text: 'For the fuller cross-surface comparison, see `docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md`.',
  },
  {
    file: OPEN_SOURCE_DOC,
    text: 'docs/SETTINGS_SURFACE_REFERENCE_REVIEW.md',
  },
  {
    file: OPEN_SOURCE_DOC,
    text: 'docs/AGENT_ACTIVITY_SURFACE_REFERENCE_REVIEW.md',
  },
  {
    file: AGENT_ACTIVITY_REVIEW_DOC,
    text: 'Future agent-activity changes should link back to this note',
  },
  {
    file: COMPOSER_REVIEW_DOC,
    text: 'npm run ui:references:audit -- --surface=composer --pro-prompt',
  },
  {
    file: SETTINGS_REVIEW_DOC,
    text: 'npm run ui:references:audit -- --surface=settings --pro-prompt',
  },
  {
    file: SETTINGS_REVIEW_DOC,
    text: 'For the fuller cross-surface comparison, see `docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md`.',
  },
  {
    file: IMAGE4_REVIEW_DOC,
    text: 'npm run ui:references:audit -- --surface=image4-presence --pro-prompt',
  },
  {
    file: IMAGE4_REVIEW_DOC,
    text: 'npm run ui:references:audit -- --surface=dial --pro-prompt',
  },
  {
    file: IMAGE4_REVIEW_DOC,
    text: 'For the fuller cross-surface comparison, see `docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md`.',
  },
  {
    file: IMAGE4_PATTERNS_DOC,
    text: 'docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md',
  },
  {
    file: OPEN_SOURCE_DOC,
    text: 'Image4 | Voice-first four-part rhythm: header, Live2D stage, conversation recap, composer.',
  },
  {
    file: OPEN_SOURCE_DOC,
    text: 'Companion tone | LobeHub-style ambient identity',
  },
  {
    file: OPEN_SOURCE_DOC,
    text: 'npm run image4:color:audit',
  },
  {
    file: OPEN_SOURCE_DOC,
    text: '--pro-send-payload',
  },
  {
    file: OPEN_SOURCE_DOC,
    text: 'paste and send it only after user confirmation',
  },
  {
    file: OPEN_SOURCE_DOC,
    text: 'Chat | Interaction density model',
  },
  {
    file: OPEN_SOURCE_DOC,
    text: 'Settings | Structural density model',
  },
  {
    file: IMAGE4_PATTERNS_DOC,
    text: 'For the fuller cross-surface comparison, see `docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md`.',
  },
  {
    file: IMAGE4_PATTERNS_DOC,
    text: 'Scope rule: do not extend this grid to chat or settings.',
  },
  {
    file: IMAGE4_PATTERNS_DOC,
    text: 'Open-source UI reference governance',
  },
  {
    file: DESIGN_CHECKLIST_DOC,
    text: 'Use `docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md` when a change borrows from external UI patterns.',
  },
  {
    file: DESIGN_CHECKLIST_DOC,
    text: 'Run `npm run ui:references:audit` when UI work adds or changes open-source reference guidance.',
  },
]

export const UNSAFE_BORROWING_PATTERNS = [
  {
    id: 'copy-exact-reference',
    pattern: /\bcopy exact(?:ly)?\b/i,
    description: 'Reference guidance must not ask contributors to copy another UI exactly.',
  },
  {
    id: 'borrow-exact-spacing',
    pattern: /\bborrow exact (?:spacing|radius|color|palette|layout|skin|visual)\b/i,
    description: 'Reference guidance may borrow constraints or behavior, not exact visual metrics.',
  },
  {
    id: 'clone-reference-skin',
    pattern: /\bclone (?:the )?(?:skin|visual|palette|layout|component tree)\b/i,
    description: 'Reference guidance must not authorize visual or component-tree cloning.',
  },
  {
    id: 'sample-reference-colors',
    pattern: /\bsample (?:the )?(?:color|colors|palette)\b/i,
    description: 'Reference guidance must not turn reference palettes into Nexus tokens.',
  },
]
