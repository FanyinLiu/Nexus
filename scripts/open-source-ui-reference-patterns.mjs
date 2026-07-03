export const SURFACE_PATTERN_MATRIX = {
  'image4-presence': [
    {
      reference: 'LobeHub / LobeChat lineage',
      axis: 'companion-identity',
      pattern: 'Agent identity as ambient hierarchy.',
      nexusMapping: 'Presence stays a secondary semantic field that changes expression by state; the visible identity remains only 星绘 and stays integrated with the dial rather than becoming a mascot, title badge, avatar, or widget.',
      avoid: 'Avatar chrome, expanded identity copy such as 星绘在身边, leading orbs, right-side orbit dots, always-on equalizer behavior, and wrapper elevation.',
    },
  ],
  dial: [
    {
      reference: 'LobeHub / LobeChat lineage',
      axis: 'ambient-context',
      pattern: 'Environment lens contained inside the companion identity field.',
      nexusMapping: 'Time, date, and weather remain ambient signals inside the dial, with separate lines and stable containment.',
      avoid: 'Dashboard widgets, ring/text collisions, orbit dots, and decorative motion that competes with conversation.',
    },
  ],
  'companion-tone': [
    {
      reference: 'LobeHub / LobeChat lineage',
      axis: 'companion-tone',
      pattern: 'Ambient agent identity uses emotional roles instead of visible theme chrome.',
      nexusMapping: 'Morning warmth, daytime calm, and night low-light should feel like distinct companion states; peach/apricot can carry restrained warmth, while sage or mist-blue supports trust and focus without taking over the field.',
      avoid: 'Sampling reference palettes, avatar-theme chrome, decorative mood lighting, high-saturation purple-blue gradients, and dark workbench defaults for morning or day states.',
    },
    {
      reference: 'Jan',
      axis: 'desktop-locality',
      pattern: 'Desktop-local trust tone stays quiet instead of becoming a runtime dashboard.',
      nexusMapping: 'Local/privacy trust cues can share the warm companion palette, but they should stay tertiary and token-governed rather than introducing provider or model-manager colors.',
      avoid: 'Local-model workbench palettes, cold admin surfaces, provider dashboards, and status chips that become the main emotional color source.',
    },
    {
      reference: 'Chatbox',
      axis: 'input-composer',
      pattern: 'Desktop chat clients keep the input area visually calm and legible.',
      nexusMapping: 'Composer and message surfaces should inherit the same low-arousal companion color roles so controls remain readable without adding persistent button tiles.',
      avoid: 'Floating action colors, high-contrast shortcut chrome, and changing control color as a substitute for alignment or hierarchy.',
    },
  ],
  composer: [
    {
      reference: 'Chatbox',
      axis: 'input-composer',
      pattern: 'Desktop composer ergonomics and local-first input clarity.',
      nexusMapping: 'Textarea, mic, send, and attachment controls share a stable center line; embedded tools can default to icon-only inside the input and reveal button feedback on hover or focus.',
      avoid: 'Floating action clusters, separate default tool tiles inside the input, oversized desktop-client chrome, and size changes used as alignment fixes.',
    },
    {
      reference: 'Jan',
      axis: 'desktop-locality',
      pattern: 'Local-first desktop AI posture keeps model/runtime status quiet.',
      nexusMapping: 'Model or local-runtime state can support trust, but it should stay tertiary and never compete with the composer.',
      avoid: 'Local-model workbench chrome, provider/runtime dashboards, and status chips that crowd the companion surface.',
    },
    {
      reference: 'Vercel AI Chatbot',
      axis: 'streaming-boundaries',
      pattern: 'Composer-first streaming flow.',
      nexusMapping: 'Streaming and disabled states clarify the main action while composer reachability remains stable.',
      avoid: 'Browser-page shell assumptions, full-width web chat spacing, and wrapper elevation during streaming.',
    },
    {
      reference: 'assistant-ui',
      axis: 'composer-state',
      pattern: 'Composer state is explicit: input, submit, attachment, and assistant run state remain separable.',
      nexusMapping: 'Nexus can borrow the state grammar while keeping its own compact companion input, tertiary disabled send state, and low-noise embedded tool styling.',
      avoid: 'Library demo skin, generic chat-app chrome, persistent toolbar styling, and replacing Nexus state ownership with off-the-shelf defaults.',
    },
    {
      reference: 'LibreChat',
      axis: 'conversation-product-boundaries',
      pattern: 'General-purpose chat products keep presets, agents, files, tools, and resumable streams discoverable without making the composer lose priority.',
      nexusMapping: 'Nexus can borrow the boundary grammar for advanced inputs and future tool choices while keeping the companion composer compact and single-intent.',
      avoid: 'ChatGPT-like input skin, multi-user workspace chrome, admin settings density, and general chat-platform navigation inside the side panel.',
    },
  ],
  chat: [
    {
      reference: 'Open WebUI',
      axis: 'chat-density',
      pattern: 'Low-noise message density with utility affordances kept secondary.',
      nexusMapping: 'Messages stay readable and dense without turning the side panel into a full AI workbench.',
      avoid: 'Admin/workspace chrome, multi-panel layouts, and platform-density controls inside the companion panel.',
    },
    {
      reference: 'Jan',
      axis: 'desktop-locality',
      pattern: 'Desktop-local trust model keeps privacy and runtime context available but quiet.',
      nexusMapping: 'Local/privacy context should appear as supporting state, not as a second conversation surface.',
      avoid: 'Model-manager panels, runtime dashboards, and generic local-AI client chrome inside chat.',
    },
    {
      reference: 'Vercel AI Chatbot',
      axis: 'streaming-boundaries',
      pattern: 'Streaming and tool/result boundaries.',
      nexusMapping: 'Assistant output, tool results, and final responses have visible boundaries while composer priority remains intact.',
      avoid: 'Normal messages becoming card stacks or a browser-first page layout.',
    },
    {
      reference: 'assistant-ui',
      axis: 'chat-thread-state',
      pattern: 'Thread, branch, action, and composer states are distinguishable without changing the whole shell.',
      nexusMapping: 'Borrow message-state clarity for retry/edit/follow-up flows while keeping companion chat visually quiet.',
      avoid: 'Demo thread chrome, large branch controls, and action rows that turn every message into a toolbar.',
    },
    {
      reference: 'AnythingLLM',
      axis: 'context-boundaries',
      pattern: 'Source context and agent capability are explicit parts of the chat contract.',
      nexusMapping: 'Desktop context, memory, and source awareness should show clear boundaries before they influence a reply.',
      avoid: 'Document-workspace density, citation panels as default chrome, and enterprise knowledge-base framing.',
    },
    {
      reference: 'LibreChat',
      axis: 'conversation-product-boundaries',
      pattern: 'Conversation history, search, agents, artifacts, and resumable streams become trustworthy when each capability has a named boundary.',
      nexusMapping: 'Nexus chat should expose memory, desktop context, tool results, and reply state as bounded companion capabilities rather than as a generic chat platform.',
      avoid: 'ChatGPT-like layout, account/workspace chrome, dense admin panels, and making every assistant feature visible by default.',
    },
  ],
  settings: [
    {
      reference: 'Cherry Studio',
      axis: 'settings-structure',
      pattern: 'Dense configuration remains usable when sections are predictable.',
      nexusMapping: 'High-trust settings such as safety, memory, and desktop awareness group by user intent instead of feature inventory.',
      avoid: 'Provider-studio chrome, dashboard card stacks, and feature density leaking into Image4.',
    },
    {
      reference: 'AnythingLLM',
      axis: 'capability-boundaries',
      pattern: 'Agent, memory, and source capabilities stay understandable when grouped by capability boundary.',
      nexusMapping: 'Desktop awareness and memory settings should expose what Nexus can see, when it acts, and how to disable it.',
      avoid: 'Enterprise workspace navigation, document-management density, and treating companion awareness as a dashboard.',
    },
    {
      reference: 'shadcn/ui',
      axis: 'component-state',
      pattern: 'Reusable form/control grammar with clear states.',
      nexusMapping: 'Settings rows use consistent labels, descriptions, controls, validation, and compact rhythm.',
      avoid: 'Default demo skin, imported radius/color language, and nested example-card composition.',
    },
    {
      reference: 'Radix UI Primitives',
      axis: 'focus-accessibility',
      pattern: 'Predictable controlled primitives and keyboard behavior.',
      nexusMapping: 'Drawer, section, modal-like controls, toggles, and menus keep visible focus and stable state ownership.',
      avoid: 'Headless abstraction churn where simple Nexus controls already work.',
    },
    {
      reference: 'LibreChat',
      axis: 'capability-boundaries',
      pattern: 'High-capability chat products stay safer when provider, agent, tool, file, and admin capabilities have explicit configuration boundaries.',
      nexusMapping: 'Nexus settings should make desktop awareness, memory, integrations, and tool permissions inspectable without turning into an admin console.',
      avoid: 'Multi-user admin navigation, workspace-management density, generic chat-platform settings, and account-centric hierarchy.',
    },
  ],
  forms: [
    {
      reference: 'shadcn/ui',
      axis: 'form-grammar',
      pattern: 'Label, description, control, and validation form grammar.',
      nexusMapping: 'Repeated form rows share a compact, scannable rhythm with purpose-specific controls.',
      avoid: 'Text-button substitutes for binary/numeric/option controls and card-heavy examples.',
    },
    {
      reference: 'Radix UI Primitives',
      axis: 'focus-accessibility',
      pattern: 'Controlled primitive behavior for switches, selects, dialogs, labels, and keyboard navigation.',
      nexusMapping: 'Nexus form rows keep visible focus, stable controlled state, and predictable label/control relationships without replacing stable local controls wholesale.',
      avoid: 'Headless abstraction churn, hidden focus, hover-only controls, and importing library demo structure.',
    },
  ],
  'focus-management': [
    {
      reference: 'Radix UI Primitives',
      axis: 'focus-accessibility',
      pattern: 'Keyboard-first focus predictability.',
      nexusMapping: 'Drawer navigation, section switching, modal-like flows, and dangerous actions preserve visible focus and clear exits.',
      avoid: 'Hover-only affordances, invisible focus, trapped scroll positions, and accidental destructive confirmation.',
    },
    {
      reference: 'assistant-ui',
      axis: 'focus-accessibility',
      pattern: 'AI interaction controls remain usable when thread, message action, and composer focus move independently.',
      nexusMapping: 'Focus should identify the active control or message action without changing panel geometry.',
      avoid: 'Hover-only message actions, hidden focus rings, and focus states that elevate wrappers.',
    },
    {
      reference: 'Cline',
      axis: 'agent-approval-boundaries',
      pattern: 'Approval and checkpoint focus stay explicit when an AI action needs user confirmation.',
      nexusMapping: 'Dangerous actions, destructive confirmations, and future desktop-control prompts should move focus to the decision, preserve a clear escape path, and return focus to the initiating control when dismissed.',
      avoid: 'IDE extension shell, terminal approval chrome, focus traps without escape, accidental default confirms, and multi-step action UI inside the companion panel.',
    },
  ],
  streaming: [
    {
      reference: 'Vercel AI Chatbot',
      axis: 'streaming-boundaries',
      pattern: 'Append-only streaming and tool/result layering.',
      nexusMapping: 'Waiting, partial output, tool result, and final answer states layer without hiding composer or breaking message continuity.',
      avoid: 'Loading animation as the main visual event, web-page chat framing, and tool results that overwhelm the conversation.',
    },
    {
      reference: 'assistant-ui',
      axis: 'streaming-boundaries',
      pattern: 'Assistant run state can expose pending, streaming, branch, and action affordances as separate states.',
      nexusMapping: 'Streaming feedback should clarify the assistant run without introducing new wrapper elevation or layout movement.',
      avoid: 'Generic thread demo chrome, large branch selectors, and state controls that dominate the conversation.',
    },
    {
      reference: 'LibreChat',
      axis: 'streaming-boundaries',
      pattern: 'Resumable streams and artifacts work best when partial output, file/tool context, and final response are separated.',
      nexusMapping: 'Nexus can borrow resumable/partial-output boundaries for future tool and desktop-context replies while preserving composer reachability.',
      avoid: 'Artifact workspace chrome, web-app chat framing, account-level conversation management, and loading states that become the primary visual event.',
    },
  ],
  'agent-activity': [
    {
      reference: 'OpenHands',
      axis: 'agent-activity-boundaries',
      pattern: 'Coding-agent activity separates observation, action, progress, and completion states.',
      nexusMapping: 'Nexus can show that it is observing, thinking, speaking, or done as companion state, while keeping real automation and task execution out of the companion panel.',
      avoid: 'Autonomous workbench chrome, terminal/task cockpit layouts, issue-agent workflows, and any Codex-like product-shell presentation.',
    },
    {
      reference: 'Vercel AI Chatbot',
      axis: 'streaming-boundaries',
      pattern: 'Run state stays subordinate to the conversation and composer.',
      nexusMapping: 'Agent-like progress should clarify the current reply or check-in without hiding the composer or becoming the main visual event.',
      avoid: 'Large loading panels, browser-page run status, and streaming chrome that competes with companion presence.',
    },
    {
      reference: 'LibreChat',
      axis: 'conversation-product-boundaries',
      pattern: 'Agents, tools, MCP, artifacts, and resumable streams need explicit boundaries before they influence the conversation.',
      nexusMapping: 'Desktop awareness should explain what context shaped a reply and what state Nexus is in, without presenting a full agent workspace.',
      avoid: 'Agent marketplace chrome, chat-platform navigation, workspace account framing, and showing every capability as always available.',
    },
    {
      reference: 'Cline',
      axis: 'agent-approval-boundaries',
      pattern: 'Human-in-the-loop agents separate plan, act, command/output, checkpoint, approval, and completion states.',
      nexusMapping: 'Nexus can borrow the approval and progress grammar for desktop-sensing companion activity while keeping actions opt-in, companion-first, and non-coding.',
      avoid: 'IDE extension shell, terminal panels, file diff chrome, autonomous coding-agent framing, and task-board metaphors.',
    },
  ],
}

export function buildSurfacePatterns(surfaceReview) {
  if (!surfaceReview) return null

  return {
    surface: surfaceReview.surface,
    patterns: SURFACE_PATTERN_MATRIX[surfaceReview.surface] ?? [],
  }
}

export function buildPatternComparison(patternMatrix = SURFACE_PATTERN_MATRIX) {
  const surfaces = Object.entries(patternMatrix).map(([surface, patterns]) => ({
    surface,
    references: [...new Set(patterns.map((pattern) => pattern.reference))],
    patterns: patterns.map((pattern) => ({ ...pattern })),
  }))
  const referenceMap = new Map()
  const axisMap = new Map()

  for (const surface of surfaces) {
    for (const pattern of surface.patterns) {
      const entry = referenceMap.get(pattern.reference) ?? {
        reference: pattern.reference,
        surfaces: [],
        patterns: [],
      }
      entry.surfaces.push(surface.surface)
      entry.patterns.push({
        surface: surface.surface,
        axis: pattern.axis,
        pattern: pattern.pattern,
        nexusMapping: pattern.nexusMapping,
        avoid: pattern.avoid,
      })
      referenceMap.set(pattern.reference, entry)

      const axisEntry = axisMap.get(pattern.axis) ?? {
        axis: pattern.axis,
        surfaces: [],
        references: [],
        patterns: [],
      }
      if (!axisEntry.surfaces.includes(surface.surface)) axisEntry.surfaces.push(surface.surface)
      if (!axisEntry.references.includes(pattern.reference)) axisEntry.references.push(pattern.reference)
      axisEntry.patterns.push({
        surface: surface.surface,
        reference: pattern.reference,
        pattern: pattern.pattern,
        nexusMapping: pattern.nexusMapping,
      })
      axisMap.set(pattern.axis, axisEntry)
    }
  }

  return {
    surfaces,
    references: [...referenceMap.values()].sort((a, b) => a.reference.localeCompare(b.reference)),
    axes: [...axisMap.values()].sort((a, b) => a.axis.localeCompare(b.axis)),
    guardrails: [
      'Borrow constraints, not skins.',
      'Map every borrowed idea to a Nexus surface before implementation.',
      'Do not copy exact spacing, colors, radius, shadows, component skin, or product chrome.',
      'Keep hard audits deterministic and leave perceived polish to human review.',
    ],
  }
}

export function formatSurfacePatterns(surfacePatterns) {
  if (!surfacePatterns) return null

  const lines = [`Open-source pattern matrix: ${surfacePatterns.surface}`, '']
  for (const pattern of surfacePatterns.patterns) {
    lines.push(`- ${pattern.reference}`)
    lines.push(`  - axis: ${pattern.axis}`)
    lines.push(`  - pattern: ${pattern.pattern}`)
    lines.push(`  - Nexus mapping: ${pattern.nexusMapping}`)
    lines.push(`  - avoid: ${pattern.avoid}`)
  }
  return lines.join('\n')
}

export function formatPatternComparison(patternComparison = buildPatternComparison()) {
  const lines = ['Open-source cross-surface pattern comparison', '']
  lines.push('Guardrails:')
  for (const guardrail of patternComparison.guardrails) {
    lines.push(`- ${guardrail}`)
  }

  lines.push('')
  lines.push('By surface:')
  for (const surface of patternComparison.surfaces) {
    lines.push(`- ${surface.surface}: ${surface.references.join(', ')}`)
    for (const pattern of surface.patterns) {
      lines.push(`  - borrow: ${pattern.pattern}`)
      lines.push(`    - axis: ${pattern.axis}`)
      lines.push(`    - Nexus mapping: ${pattern.nexusMapping}`)
      lines.push(`    - avoid: ${pattern.avoid}`)
    }
  }

  lines.push('')
  lines.push('By paradigm axis:')
  for (const axis of patternComparison.axes) {
    lines.push(`- ${axis.axis}: ${axis.surfaces.join(', ')}`)
    lines.push(`  - references: ${axis.references.join(', ')}`)
    for (const pattern of axis.patterns) {
      lines.push(`  - ${pattern.surface} / ${pattern.reference}: ${pattern.pattern}`)
    }
  }

  lines.push('')
  lines.push('By reference:')
  for (const reference of patternComparison.references) {
    lines.push(`- ${reference.reference}: ${reference.surfaces.join(', ')}`)
    for (const pattern of reference.patterns) {
      lines.push(`  - ${pattern.surface}: ${pattern.pattern}`)
    }
  }

  return lines.join('\n')
}
