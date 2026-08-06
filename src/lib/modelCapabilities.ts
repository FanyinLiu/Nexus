// Renderer-facing re-export of the canonical shared/modelCapabilities.js
// heuristics (single source of truth — see that file). Kept so existing
// renderer import sites (providerCatalog, panel views, tests) stay put.
export {
  estimateModelContextWindowTokens,
  modelSupportsSpeech,
  modelSupportsVision,
} from '../../shared/modelCapabilities.js'
