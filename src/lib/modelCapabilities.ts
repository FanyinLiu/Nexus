// Vision-capable model detection by model id.
//
// A heuristic match against well-known multimodal families. We default to
// "no vision" when uncertain so users on text-only models don't see a
// non-functional attachment button — false negatives are recoverable
// (user can switch to a known vision model), false positives ship a
// broken paste flow.

const VISION_MODEL_PATTERNS: readonly RegExp[] = [
  /gpt-4o(?!-mini-tts|-mini-transcribe|-transcribe)/i,
  /gpt-4\.1/i,
  /gpt-4-vision/i,
  /gpt-4-turbo/i,
  /gpt-5/i,
  /\bo3\b|\bo4\b/i,
  /claude-3/i,
  /claude-4/i,
  /claude-5/i,
  /claude-(opus|sonnet|haiku)/i,
  /gemini/i,
  /qwen.*-vl/i,
  /qwen2(\.5)?-vl/i,
  /\bvl-/i,
  /-vl\b/i,
  /\bvision\b/i,
  /pixtral/i,
  /llava/i,
  /llama-?\d+(\.\d+)?-vision/i,
  /minicpm-?v/i,
  /moondream/i,
  /internvl/i,
  /cogvlm/i,
  /yi-vl/i,
  /glm-4v/i,
  /step-1v/i,
]

export function modelSupportsVision(model: string | null | undefined): boolean {
  if (!model) return false
  const id = model.trim()
  if (!id) return false
  return VISION_MODEL_PATTERNS.some((pattern) => pattern.test(id))
}

export function modelSupportsSpeech(model: string | null | undefined): boolean {
  if (!model) return false
  const id = model.trim().toLowerCase()
  if (!id) return false
  return /realtime|audio|voice|tts|transcribe|speech/.test(id)
}

export function estimateModelContextWindowTokens(model: string | null | undefined): number | null {
  if (!model) return null
  const id = model.trim().toLowerCase()
  if (!id) return null

  if (/2m|2000k|grok-4\.20|grok-4-1-fast|grok-4-fast/.test(id)) return 2_000_000
  if (/gpt-5\.4-mini/.test(id)) return 400_000
  if (/gpt-5\.4-nano/.test(id)) return 128_000
  if (/qwen3\.6-max/.test(id)) return 256_000
  if (/1m|1000k|grok-4\.3|gpt-5\.5|gpt-5\.4|gemini-(3|2\.5)|deepseek-v4|deepseek-chat|deepseek-reasoner|qwen3\.7|qwen3\.6|qwen3\.5-(plus|flash)|qwen3-coder-(plus|flash)|claude-opus-4-8|claude-opus-4-7|claude-sonnet-4-6/.test(id)) return 1_000_000
  if (/260k|256k|250k|grok-build|qwen3-max|qwen3-(235b|next|32b|30b|14b|8b|4b|1\.7b|0\.6b)|qwen3\.5-\d|kimi-k2|moonshotai\/kimi-k2|doubao-seed-2|seed-2|dola-seed-2|mistral-(large|medium-3-5)|mistral-small-2603|magistral|devstral/.test(id)) return 256_000
  if (/200k|claude|sonnet|opus|haiku|minimax-m2|glm-5|glm-4\.7/.test(id)) return 200_000
  if (/128k|qwen3|max|gpt-5|gpt-4\.1|o3|o4|ernie-5|llama-3\.3|nemotron/.test(id)) return 128_000
  if (/64k/.test(id)) return 64_000
  if (/32k|codestral|qwen.*coder|coder/.test(id)) return 32_000
  if (/16k|llama-3|mistral-small/.test(id)) return 16_000
  if (/8k|qwen3:8b|qwen2|llama|mistral-7b/.test(id)) return 8_000

  return null
}
