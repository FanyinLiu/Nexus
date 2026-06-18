import { randomUUID } from 'node:crypto'

export function mapCardToPersona(card) {
  const { data } = card
  const name = String(data.name ?? '').trim()
  const profileId = `card-${randomUUID().slice(0, 8)}`

  // ── soul.md ──
  const soulSections = [`# ${name}`]
  if (data.description?.trim()) soulSections.push(data.description.trim())
  if (data.personality?.trim()) soulSections.push(`## Personality\n${data.personality.trim()}`)
  if (data.scenario?.trim()) soulSections.push(`## Scenario\n${data.scenario.trim()}`)
  if (data.system_prompt?.trim()) soulSections.push(`## System Instructions\n${data.system_prompt.trim()}`)
  if (data.post_history_instructions?.trim()) {
    soulSections.push(`## Post-History Instructions\n${data.post_history_instructions.trim()}`)
  }
  const soulMarkdown = soulSections.join('\n\n')

  // ── memory.md ──
  const memory = data.creator_notes?.trim() ?? ''

  // ── examples.md ──
  const examplesMd = convertMesExample(data.mes_example, name)

  // ── style.json ──
  const tags = Array.isArray(data.tags) ? data.tags.map((t) => String(t).trim()).filter(Boolean) : []
  const rolePackagePreset = buildRolePackagePreset(data, tags)
  const style = rolePackagePreset.style

  // ── lorebook entries ──
  const lorebookEntries = convertCharacterBook(data.character_book)

  // ── greeting ──
  const greeting = String(data.first_mes ?? '').trim() || null

  const mapped = {
    profileId,
    files: {
      'soul.md': soulMarkdown,
      'memory.md': memory,
      'examples.md': examplesMd,
      'style.json': JSON.stringify(style, null, 2),
      'voice.json': JSON.stringify(rolePackagePreset.voice, null, 2),
      'tools.json': JSON.stringify(rolePackagePreset.tools, null, 2),
    },
    profile: {
      id: profileId,
      label: name,
      companionName: name,
      // The card's assembled identity — same content as soul.md — so an
      // imported card actually drives chat via settings.systemPrompt even when
      // the per-profile chat persona flag is off (was a "[Character card: X]"
      // placeholder that leaked into the prompt as literal text).
      systemPrompt: soulMarkdown,
      petModelId: rolePackagePreset.petModelId,
      ...(rolePackagePreset.voice.providerId ? { speechOutputProviderId: rolePackagePreset.voice.providerId } : {}),
      ...(rolePackagePreset.voice.voice ? { speechOutputVoice: rolePackagePreset.voice.voice } : {}),
      ...(rolePackagePreset.voice.model ? { speechOutputModel: rolePackagePreset.voice.model } : {}),
      ...(rolePackagePreset.voice.instructions ? { speechOutputInstructions: rolePackagePreset.voice.instructions } : {}),
    },
    greeting,
    lorebookEntries,
    rolePackagePreset,
  }
  return {
    ...mapped,
    importReport: buildCharacterCardImportReport(card, mapped),
  }
}

export function buildCharacterCardImportReport(card, mapped, generatedAt = new Date().toISOString()) {
  const data = card?.data && typeof card.data === 'object' ? card.data : {}
  const files = mapped?.files && typeof mapped.files === 'object' ? mapped.files : {}
  const profile = mapped?.profile && typeof mapped.profile === 'object' ? mapped.profile : {}
  const lorebookEntries = Array.isArray(mapped?.lorebookEntries) ? mapped.lorebookEntries : []
  const sourceBookEntries = Array.isArray(data.character_book?.entries)
    ? data.character_book.entries
    : []
  const exampleBlocks = String(data.mes_example ?? '')
    .split(/<START>/gi)
    .filter((block) => block.trim())
    .length
  const fileNames = ['soul.md', 'memory.md', 'examples.md', 'style.json', 'voice.json', 'tools.json']
  const personaFiles = Object.fromEntries(fileNames.map((filename) => {
    const content = typeof files[filename] === 'string' ? files[filename] : ''
    return [filename, {
      chars: content.length,
      present: Object.prototype.hasOwnProperty.call(files, filename),
    }]
  }))
  const enabledLorebookEntries = lorebookEntries.filter((entry) => entry.enabled !== false).length
  const lorebookKeywordCount = lorebookEntries.reduce((sum, entry) => (
    sum + (Array.isArray(entry.keywords) ? entry.keywords.length : 0)
  ), 0)
  const rolePackagePreset = normalizeRolePackagePresetForReport(mapped?.rolePackagePreset)
  const cardName = String(data.name ?? '').trim()
  const checks = [
    {
      id: 'card-name',
      pass: cardName.length > 0,
      detail: cardName ? 'card name is present' : 'card name is missing',
    },
    {
      id: 'profile-created',
      pass: Boolean(profile.id && profile.companionName),
      detail: `${profile.id || '(missing)'} / ${profile.companionName || '(missing)'}`,
    },
    {
      id: 'system-prompt-matches-soul',
      pass: Boolean(files['soul.md']) && profile.systemPrompt === files['soul.md'],
      detail: profile.systemPrompt === files['soul.md']
        ? 'profile systemPrompt matches soul.md'
        : 'profile systemPrompt does not match soul.md',
    },
    {
      id: 'persona-files-written',
      pass: fileNames.every((filename) => Object.prototype.hasOwnProperty.call(files, filename)),
      detail: fileNames.filter((filename) => Object.prototype.hasOwnProperty.call(files, filename)).join(', '),
    },
    {
      id: 'examples-normalized',
      pass: exampleBlocks === 0 || String(files['examples.md'] ?? '').trim().length > 0,
      detail: `${exampleBlocks} source example block(s)`,
    },
    {
      id: 'lorebook-normalized',
      pass: sourceBookEntries.length === 0 || lorebookEntries.length > 0,
      detail: `${lorebookEntries.length}/${sourceBookEntries.length} lorebook entries imported`,
    },
    {
      id: 'greeting-captured',
      pass: !String(data.first_mes ?? '').trim() || mapped.greeting != null,
      detail: mapped.greeting ? 'first_mes captured as pending greeting' : 'no first_mes on source card',
    },
    {
      id: 'role-package-preset-normalized',
      pass: !rolePackagePreset.explicit || rolePackagePreset.validFieldCount > 0,
      detail: rolePackagePreset.explicit
        ? `${rolePackagePreset.validFieldCount} safe preset field(s) imported`
        : 'no Nexus role package preset extension on source card',
    },
  ]

  return {
    schemaVersion: 1,
    gate: 'character-card-import',
    generatedAt: normalizeIso(generatedAt),
    spec: String(card?.spec ?? ''),
    profile: {
      id: String(profile.id ?? ''),
      label: String(profile.label ?? ''),
      companionName: String(profile.companionName ?? ''),
      petModelId: String(profile.petModelId ?? ''),
      systemPromptChars: String(profile.systemPrompt ?? '').length,
    },
    source: {
      name: cardName,
      hasDescription: Boolean(String(data.description ?? '').trim()),
      hasPersonality: Boolean(String(data.personality ?? '').trim()),
      hasScenario: Boolean(String(data.scenario ?? '').trim()),
      hasSystemPrompt: Boolean(String(data.system_prompt ?? '').trim()),
      hasPostHistoryInstructions: Boolean(String(data.post_history_instructions ?? '').trim()),
      hasCreatorNotes: Boolean(String(data.creator_notes ?? '').trim()),
      hasGreeting: Boolean(String(data.first_mes ?? '').trim()),
      exampleBlocks,
      characterBookEntries: sourceBookEntries.length,
    },
    personaFiles,
    lorebook: {
      entries: lorebookEntries.length,
      enabledEntries: enabledLorebookEntries,
      keywordCount: lorebookKeywordCount,
    },
    rolePackagePreset,
    checks,
  }
}

function normalizeIso(value) {
  const parsed = Date.parse(String(value ?? ''))
  if (!Number.isFinite(parsed)) return new Date().toISOString()
  return new Date(parsed).toISOString()
}

function convertMesExample(mesExample, charName) {
  if (!mesExample?.trim()) return ''
  const blocks = mesExample.split(/<START>/gi).filter((b) => b.trim())
  const sections = []
  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].trim().split(/\r?\n/)
    const turns = []
    for (const line of lines) {
      const cleaned = line
        .replace(/\{\{user\}\}/gi, 'User')
        .replace(/\{\{char\}\}/gi, 'Assistant')
      const userMatch = cleaned.match(/^User\s*[:：]\s*(.*)$/i)
      if (userMatch) { turns.push(`User: ${userMatch[1]}`); continue }
      const charMatch = cleaned.match(new RegExp(`^(?:Assistant|${escapeRegex(charName)})\\s*[:：]\\s*(.*)$`, 'i'))
      if (charMatch) { turns.push(`Assistant: ${charMatch[1]}`); continue }
      if (turns.length) turns[turns.length - 1] += `\n${line}`
    }
    if (turns.length) {
      sections.push(`### Example ${i + 1}\n${turns.join('\n')}`)
    }
  }
  return sections.join('\n\n')
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function convertCharacterBook(book) {
  if (!book?.entries || !Array.isArray(book.entries)) return []
  const now = new Date().toISOString()
  return book.entries
    .filter((e) => e && typeof e === 'object')
    .map((entry, index) => {
      const keys = Array.isArray(entry.keys)
        ? entry.keys.map((k) => String(k).trim()).filter(Boolean)
        : Array.isArray(entry.key)
          ? entry.key.map((k) => String(k).trim()).filter(Boolean)
          : []
      return {
        id: `card-lore-${Date.now()}-${index}`,
        label: String(entry.comment || entry.name || entry.display_name || `Entry ${index + 1}`).trim(),
        keywords: keys,
        content: String(entry.content ?? '').trim(),
        enabled: entry.enabled !== false && entry.disable !== true,
        priority: Number.isFinite(entry.priority) ? entry.priority
          : Number.isFinite(entry.insertion_order) ? entry.insertion_order
            : 0,
        createdAt: now,
        updatedAt: now,
      }
    })
    .filter((e) => e.content && e.keywords.length)
}

const SAFE_IMPORTED_VOICE_PROVIDER_IDS = new Set([
  'edge-tts',
  'local-tts',
  'omnivoice-tts',
])

function buildRolePackagePreset(data, sourceTags) {
  const extension = resolveNexusExtension(data)
  const styleSource = pickPlainObject(extension?.style, extension?.personaStyle, extension)
  const voiceSource = pickPlainObject(extension?.voice, extension?.tts)
  const toolsSource = pickPlainObject(extension?.tools)
  const requestedProviderId = normalizeIdentifier(voiceSource?.providerId ?? voiceSource?.provider)
  const providerId = requestedProviderId && SAFE_IMPORTED_VOICE_PROVIDER_IDS.has(requestedProviderId)
    ? requestedProviderId
    : ''
  const toneTags = uniqueStrings([
    ...sourceTags,
    ...normalizeStringList(styleSource?.toneTags ?? styleSource?.tags, 24, 80),
  ])
  const style = compactObject({
    toneTags,
    signaturePhrases: normalizeStringList(styleSource?.signaturePhrases, 16, 120),
    forbiddenPhrases: normalizeStringList(styleSource?.forbiddenPhrases, 16, 120),
  })
  const voice = compactObject({
    providerId,
    voice: normalizeIdentifier(voiceSource?.voice ?? voiceSource?.voiceId, 120),
    model: normalizeIdentifier(voiceSource?.model ?? voiceSource?.modelId, 120),
    instructions: normalizeString(voiceSource?.instructions, 240),
  })
  const tools = compactObject({
    allowlist: normalizeStringList(toolsSource?.allowlist ?? toolsSource?.allow, 32, 80),
    blocklist: normalizeStringList(toolsSource?.blocklist ?? toolsSource?.block, 32, 80),
  })
  const petModelId = normalizeIdentifier(extension?.petModelId ?? extension?.appearance?.petModelId, 120)

  return {
    explicit: Boolean(extension),
    style,
    voice,
    tools,
    petModelId,
    ignored: {
      apiBaseUrl: Boolean(voiceSource?.apiBaseUrl ?? voiceSource?.baseUrl),
      apiKey: Boolean(voiceSource?.apiKey),
      unsupportedProviderId: Boolean(requestedProviderId && !providerId),
    },
  }
}

function resolveNexusExtension(data) {
  const extensions = pickPlainObject(data?.extensions)
  return pickPlainObject(
    extensions?.nexusRolePreset,
    extensions?.nexus_role_preset,
    extensions?.nexus?.rolePackage,
    extensions?.nexus?.rolePackagePreset,
    extensions?.nexus,
  )
}

function normalizeRolePackagePresetForReport(preset) {
  const style = pickPlainObject(preset?.style) ?? {}
  const voice = pickPlainObject(preset?.voice) ?? {}
  const tools = pickPlainObject(preset?.tools) ?? {}
  const ignored = pickPlainObject(preset?.ignored) ?? {}
  const styleCount = countStringArray(style.toneTags)
    + countStringArray(style.signaturePhrases)
    + countStringArray(style.forbiddenPhrases)
  const voiceCount = [
    voice.providerId,
    voice.voice,
    voice.model,
    voice.instructions,
  ].filter((value) => typeof value === 'string' && value.trim()).length
  const toolsCount = countStringArray(tools.allowlist) + countStringArray(tools.blocklist)
  const petModelId = typeof preset?.petModelId === 'string' && preset.petModelId.trim()
  return {
    explicit: Boolean(preset?.explicit),
    validFieldCount: styleCount + voiceCount + toolsCount + (petModelId ? 1 : 0),
    style: {
      toneTagCount: countStringArray(style.toneTags),
      signaturePhraseCount: countStringArray(style.signaturePhrases),
      forbiddenPhraseCount: countStringArray(style.forbiddenPhrases),
    },
    voice: {
      hasProviderId: Boolean(voice.providerId),
      hasVoice: Boolean(voice.voice),
      hasModel: Boolean(voice.model),
      hasInstructions: Boolean(voice.instructions),
      ignoredApiBaseUrl: Boolean(ignored.apiBaseUrl),
      ignoredApiKey: Boolean(ignored.apiKey),
      ignoredUnsupportedProviderId: Boolean(ignored.unsupportedProviderId),
    },
    tools: {
      allowlistCount: countStringArray(tools.allowlist),
      blocklistCount: countStringArray(tools.blocklist),
    },
    petModel: {
      provided: Boolean(petModelId),
    },
  }
}

function pickPlainObject(...values) {
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
  }
  return null
}

function normalizeString(value, maxChars) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return text.slice(0, maxChars)
}

function normalizeIdentifier(value, maxChars = 120) {
  const text = normalizeString(value, maxChars)
  if (!text) return ''
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text : ''
}

function normalizeStringList(value, maxItems, maxChars) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,，\n]/u)
      : []
  return uniqueStrings(
    raw
      .map((entry) => normalizeString(entry, maxChars))
      .filter(Boolean),
  ).slice(0, maxItems)
}

function uniqueStrings(values) {
  const out = []
  const seen = new Set()
  for (const value of values) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => {
    if (Array.isArray(entry)) return entry.length > 0
    if (entry && typeof entry === 'object') return Object.keys(entry).length > 0
    return Boolean(entry)
  }))
}

function countStringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()).length : 0
}
