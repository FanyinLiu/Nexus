import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildImage4VisualContractReport } from '../scripts/image4-visual-contract-audit.mjs'
const BASELINE_FILES: Record<string, string> = {
  'src/app/appSupport.ts': `
export function getImage4PreviewModeSync() {
  return new URLSearchParams(window.location.search).get('image4Preview') === '1'
}
export function getImage4RhythmGridModeSync() {
  return new URLSearchParams(window.location.search).get('image4Grid') === '1'
}
export function getImage4SnapshotModeSync() {
  return new URLSearchParams(window.location.search).get('image4Snapshot') === '1'
}
export function getImage4StatePreviewSync() {
  const value = new URLSearchParams(window.location.search).get('image4State')
  return value === 'idle' || value === 'attentive' || value === 'speaking' || value === 'resting'
    ? value
    : null
}
`,
  'src/app/views/LegacyPanelView.tsx': `
import { Image4PresenceHeader } from './Image4CompanionField'
import { Image4RhythmGrid } from './Image4RhythmGrid'
import { Live2DCanvas } from '../../features/pet/components/Live2DCanvas'
import { deriveImage4CompanionState } from './image4CompanionState'
export function PanelView() {
  const image4RhythmGridMode = true
  const image4SnapshotMode = false
  const image4StatePreview = useMemo(() => getImage4StatePreviewSync(), [])
  const image4HeaderTitle = settings.companionName
  const image4TopStatusLabel = '在线'
  const image4ElapsedBucket = 'about_half_hour'
  const image4CompanionState = deriveImage4CompanionState({
    voiceState: voice.voiceState,
    assistantActivity: chat.assistantActivity,
    chatBusy: chat.busy,
    elapsedBucket: image4ElapsedBucket,
    statePreview: image4StatePreview,
  })
  return (
    <section
      className={\`companion-chat image4-chat \${image4SnapshotMode ? 'is-image4-snapshot' : ''}\`}
      data-companion-mode={image4CompanionState.mode}
      data-companion-tone={image4CompanionState.contextTone}
      style={{
        '--image4-companion-intensity': image4CompanionState.intensity.toFixed(2),
        '--image4-presence-pulse': image4CompanionState.presencePulse.toFixed(2),
      }}
    >
      {image4RhythmGridMode ? <Image4RhythmGrid /> : null}
      <Image4PresenceHeader body="在这儿陪着你。" signalActive={image4CompanionState.signalActive} statusLabel={image4TopStatusLabel} title={image4HeaderTitle} />
      <div className="image4-live2d-stage"><Live2DCanvas isSpeaking={image4CompanionState.mode === 'speaking'} /></div>
      <div className="image4-conversation-recap" />
      <div className="image4-message-list--archive" />
    </section>
  )
}
`,
  'src/app/views/image4CompanionState.ts': `
export type Image4CompanionMode = 'idle' | 'attentive' | 'speaking' | 'resting'
export type Image4ContextTone = 'calm' | 'active' | 'night' | 'focus'
export type Image4CompanionStateInput = {
  elapsedBucket?: CompanionElapsedBucket
  statePreview?: string | null
}
function hasRestingElapsed(bucket) {
  return bucket === 'about_hour' || bucket === 'two_hours_or_more'
}
export function coerceImage4CompanionMode(value) {
  if (value === 'idle' || value === 'attentive' || value === 'speaking' || value === 'resting') {
    return value
  }
  return null
}
function deriveImage4PreviewState(mode) {
  if (mode === 'speaking') {
    return { mode: 'speaking', contextTone: 'active', intensity: 1, signalActive: true, dialEmphasis: 0.92, presencePulse: 1 }
  }
  if (mode === 'resting') {
    return { mode: 'resting', contextTone: 'calm', intensity: 0.18, signalActive: false, dialEmphasis: 0.96, presencePulse: 0.12 }
  }
  return { mode, contextTone: mode === 'attentive' ? 'focus' : 'calm', intensity: mode === 'attentive' ? 0.62 : 0.24, signalActive: false, dialEmphasis: 1, presencePulse: mode === 'attentive' ? 0.42 : 0.18 }
}
export function deriveImage4CompanionState(input) {
  const previewMode = coerceImage4CompanionMode(input.statePreview)
  if (previewMode) return deriveImage4PreviewState(previewMode)
  if (input.voiceState === 'speaking' || input.assistantActivity === 'speaking') {
    return { mode: 'speaking', contextTone: 'active', intensity: 1, signalActive: true, dialEmphasis: 0.92, presencePulse: 1 }
  }
  if (input.voiceState === 'listening' || input.assistantActivity === 'listening') {
    return {
      mode: 'attentive',
      contextTone: 'focus',
      intensity: 0.62,
      signalActive: false,
      dialEmphasis: 1,
      presencePulse: 0.42,
    }
  }
  if (input.voiceState === 'processing' || input.chatBusy || input.assistantActivity === 'summarizing') {
    return {
      mode: 'attentive',
      contextTone: 'active',
      intensity: 0.54,
      signalActive: false,
      dialEmphasis: 1,
      presencePulse: 0.32,
    }
  }
  if (hasRestingElapsed(input.elapsedBucket)) {
    return { mode: 'resting', contextTone: 'calm', intensity: 0.18, signalActive: false, dialEmphasis: 0.96, presencePulse: 0.12 }
  }
  return { mode: 'idle', contextTone: 'calm', intensity: 0.24, signalActive: false, dialEmphasis: 1, presencePulse: 0.18 }
}
`,
  'src/app/views/image4ComposerState.ts': `
export type Image4ComposerMode = 'idle' | 'drafting' | 'streaming' | 'interrupted'
export type Image4ComposerSendState = 'disabled' | 'ready' | 'busy'
export type Image4ComposerVoiceMode = 'idle' | 'listening' | 'processing' | 'speaking'
export function deriveImage4ComposerState(input) {
  const hasDraft = input.input.trim().length > 0 || input.hasPendingImage; const mode = input.busy ? (hasDraft ? 'interrupted' : 'streaming') : 'idle'; const sendState = input.busy ? 'busy' : 'disabled'; return { mode, sendState, hasDraft, voiceMode: input.voiceState }
}
`,
  'src/app/views/Image4CompanionField.tsx': `
import { Image4Signal } from './Image4Signal'
export function Image4PresenceHeader({ body, signalActive, statusLabel, title }) {
  return <section className="companion-presence image4-presence"><strong>{title}</strong><span>{body}</span><span>{statusLabel}</span><Image4Signal active={signalActive} /></section>
}
`,
  'src/app/views/Image4Signal.tsx': `
const IMAGE4_SIGNAL_BAR_COUNT = 64
export function Image4Signal() {
  return (
    <div className="companion-presence__signal is-idle">
      {Array.from({ length: IMAGE4_SIGNAL_BAR_COUNT }, (_, index) => (
        <span key={index} className="companion-presence__signal-bar is-speaking" />
      ))}
    </div>
  )
}
`,
  'src/app/views/Image4RhythmGrid.tsx': `
const IMAGE4_RHYTHM_ROWS = [
  ['header', 'H'],
  ['stage', 'L'],
  ['recap', 'R'],
  ['composer', 'C'],
] as const
export function Image4RhythmGrid() {
  return <div className="image4-rhythm-grid"><div className="image4-rhythm-grid__rail" /></div>
}
`,
  'src/app/styles/panel-companion.css': `
@import './panel-companion-shell.css';
@import './panel-companion-dial.css';
@import './panel-companion-layout.css';
@import './panel-companion-chat.css';
@import './panel-companion-messages.css';
@import './panel-companion-composer.css';
@import './panel-companion-rhythm.css';
@import './panel-companion-motion.css';
`,
  'src/app/styles/panel-companion-dial.css': `
.panel-window--image4 .image4-chat[data-companion-mode='speaking'] .companion-presence__dial { opacity: var(--image4-dial-emphasis); }
.panel-window--image4 .image4-chat[data-companion-mode='speaking'] .companion-presence__dial-voice { opacity: 1; }
.panel-window--image4 .image4-chat[data-companion-mode='speaking'] .companion-presence__dial-voice-ring { animation: image4-dial-voice-ring 2.7s ease-in-out infinite; }
.panel-window--image4 .image4-chat[data-companion-mode='resting'] .companion-presence__dial { opacity: var(--image4-dial-emphasis); }
.panel-window--image4 .companion-presence__dial .companion-presence__dial-meta { display: grid; justify-items: center; overflow: hidden; }
.panel-window--image4 .companion-presence__dial .companion-presence__dial-meta span { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.panel-window--image4 .companion-presence__dial .companion-presence__dial-meta span + span { color: rgba(255, 213, 145, 0.62); }
.panel-window--image4 .companion-presence__dial::before { animation: image4-dial-ticks 48s linear infinite; }
.panel-window--image4 .companion-presence__dial-layer--arc { animation: image4-dial-arc 28s linear infinite; }
`,
  'src/app/styles/panel-companion-composer.css': `
.panel-window--image4 .image4-composer__field,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field {
  height: clamp(58px, 6.7vh, 76px);
}
/* Xinghui companion palette for the main intent field. */
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field {
  border-color: var(--image4-companion-border);
  background: linear-gradient(180deg, var(--image4-companion-surface), var(--image4-companion-surface-strong));
}
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field:focus-within {
  border-color: color-mix(in srgb, var(--image4-companion-secondary) 46%, var(--image4-companion-border));
}
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field textarea {
  color: var(--image4-companion-text);
}
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field textarea::placeholder {
  color: var(--image4-companion-muted);
}
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field textarea:focus {
  border-color: transparent;
}
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field .image4-attachment-pill,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field .composer__actions .ghost-button {
  color: color-mix(in srgb, var(--image4-companion-muted) 88%, var(--image4-companion-text));
  width: 29px;
  height: 29px;
  background: transparent;
}
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field .composer__actions .primary-button {}
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field[data-send-state='ready'] .composer__actions .primary-button:not(:disabled) {}
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field[data-send-state='busy'] .composer__actions .primary-button,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field[data-voice-state='processing'] .composer__actions .ghost-button {
  color: color-mix(in srgb, var(--image4-companion-muted) 64%, var(--image4-companion-text));
}
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field[data-send-state='disabled'] .composer__actions .primary-button:disabled {
  color: color-mix(in srgb, var(--image4-companion-muted) 36%, transparent);
}
.panel-window--image4 .image4-composer__field .image4-attachment-pill:hover,
.panel-window--image4 .image4-composer__field .composer__actions .primary-button:hover,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field .composer__actions .primary-button:hover {
  transform: none; box-shadow: none;
}
`,
  'src/app/styles/panel-companion-shell.css': `
.panel-window--image4 .panel-window__header-actions--image4,
html[data-theme='warm-day'] .panel-window--image4 .panel-window__header-actions--image4 {
  gap: clamp(4px, 0.8vw, 6px);
  padding: clamp(2px, 0.5vw, 4px) clamp(3px, 0.8vw, 5px);
}
.panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button,
html[data-theme='warm-day'] .panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button {
  width: clamp(24px, 3.8vw, 34px);
  height: clamp(24px, 3.8vw, 34px);
  min-width: clamp(24px, 3.8vw, 34px);
}
.panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button--settings,
html[data-theme='warm-day'] .panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button--settings {
  color: rgba(214, 228, 255, 0.78);
}
.panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button--collapse,
html[data-theme='warm-day'] .panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button--collapse {
  color: rgba(255, 213, 145, 0.66);
}
.panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button svg {
  width: clamp(13px, 2.1vw, 18px);
  height: clamp(13px, 2.1vw, 18px);
}
.panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button:hover,
html[data-theme='warm-day'] .panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button:hover {
  transform: none;
  background: var(--image4-state-hover-neutral-bg);
}
.panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button--collapse:hover,
html[data-theme='warm-day'] .panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button--collapse:hover {
  background: rgba(255, 213, 145, 0.07);
}
.panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button:focus-visible,
html[data-theme='warm-day'] .panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button:focus-visible {
  box-shadow: var(--image4-state-focus-ring);
}
.panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button--danger,
html[data-theme='warm-day'] .panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button--danger {
  color: rgba(255, 174, 174, 0.62);
}
.panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button--danger:hover,
html[data-theme='warm-day'] .panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button--danger:hover {
  background: var(--image4-state-hover-danger-bg);
}
html[data-theme='warm-day'] .desktop-pet-root--panel:has(.panel-window--image4) {
  --image4-companion-bg: #fff6ea;
  --image4-companion-surface: #fffaf3;
  --image4-companion-surface-strong: #f4e4d0;
  --image4-companion-primary: #d98257;
  --image4-companion-primary-soft: #ffd7b8;
  --image4-companion-secondary: #7fa99b;
  --image4-companion-text: #302823;
  --image4-companion-muted: #7a6a5e;
  --image4-companion-border: rgba(96, 70, 48, 0.16);
  --image4-companion-glow: rgba(245, 174, 111, 0.28);
  --image4-companion-secondary-glow: rgba(127, 169, 155, 0.22);
  background: var(--image4-companion-bg);
}
html[data-theme='warm-day'] .desktop-pet-root--panel:has(.panel-window--image4)::before {
  background: url("../../features/panelScene/scenes/seaside.day.jpg");
  filter: blur(1.6px) sepia(0.18) saturate(1.08) brightness(0.96);
}
html[data-theme='warm-day'] .desktop-pet-root--panel:has(.panel-window--image4)::after {
  background: radial-gradient(circle at 22% 28%, rgba(255, 178, 118, 0.11), transparent 56%);
}
html[data-theme='warm-day'] .panel-window--image4.panel-window--simple {
  border-color: var(--image4-companion-border);
  background: radial-gradient(circle at 44% 4%, rgba(255, 185, 120, 0.09), transparent 54%);
  color: var(--image4-companion-text);
}
html[data-theme='warm-day'] .panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button--settings {
  color: rgba(255, 232, 206, 0.78);
}
/* Codex-app toolbar pass: clear individual tools without a shared button tray. */
.panel-window--image4 .panel-window__header-actions--image4,
html[data-theme='warm-day'] .panel-window--image4 .panel-window__header-actions--image4 {
  padding: 0;
  border: 0;
  background: transparent;
  backdrop-filter: none;
}
.panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button--settings,
html[data-theme='warm-day'] .panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button--settings {
  border: 1px solid color-mix(in srgb, var(--image4-companion-border, rgba(240, 246, 252, 0.12)) 72%, transparent);
  background: color-mix(in srgb, var(--image4-companion-surface, rgba(22, 27, 34, 0.72)) 42%, transparent);
}
html[data-theme='warm-day'] .panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button--danger:hover {
  background: rgba(214, 94, 88, 0.1);
}
.panel-window--image4.panel-window--simple {
  container-type: inline-size;
}
@media (min-aspect-ratio: 1 / 1) {
  .panel-window--image4.panel-window--simple,
  html[data-theme='warm-day'] .panel-window--image4.panel-window--simple {
    width: min(742px, calc(100vw - 50px), calc((100vh - 58px) * 742 / 1738));
    padding: clamp(16px, 7cqw, 34px) clamp(14px, 7cqw, 32px) clamp(14px, 5.8cqw, 28px);
  }
  .panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button {
    width: clamp(20px, 9cqw, 28px);
  }
  .panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button svg {
    height: clamp(11px, 4.5cqw, 15px);
  }
}
`,
  'src/app/styles/panel-companion-layout.css': `
.panel-window--image4 .image4-chat {
  --image4-rhythm-presence: 1px;
  --image4-rhythm-dial: 1px;
  --image4-rhythm-greeting: 1px;
  --image4-rhythm-actions: 1px;
  --image4-rhythm-composer: 1px;
  --image4-row-buffer-y: 1px;
  --image4-row-boundary-line: rgba(214, 231, 252, 0.06);
  --image4-weight-actions-surface:
    linear-gradient(90deg, rgba(120, 170, 255, 0.02), rgba(255, 255, 255, 0.008) 48%, rgba(255, 255, 255, 0)),
    rgba(255, 255, 255, 0.006);
  --image4-weight-actions-hover:
    linear-gradient(90deg, rgba(120, 170, 255, 0.026), rgba(255, 255, 255, 0.012) 48%, rgba(255, 255, 255, 0)),
    rgba(255, 255, 255, 0.04);
  --image4-composer-base-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 10px 22px rgba(0, 0, 0, 0.2);
  --image4-composer-focus-shadow:
    inset 0 0 0 1px rgba(111, 226, 239, 0.07),
    0 0 0 3px rgba(111, 226, 239, 0.075),
    0 10px 24px rgba(0, 0, 0, 0.22);
  --image4-state-focus-border: rgba(111, 226, 239, 0.18);
  --image4-state-focus-ring:
    0 0 0 1px rgba(111, 226, 239, 0.22),
    0 0 0 3px rgba(111, 226, 239, 0.08);
  --image4-state-hover-neutral-bg: rgba(255, 255, 255, 0.05);
  --image4-state-hover-primary-bg: rgba(111, 226, 239, 0.12);
  --image4-state-hover-danger-bg: rgba(255, 140, 145, 0.06);
  --image4-motion-reduced-signal-duration: 5.8s;
  --image4-motion-reduced-signal-opacity: 0.5;
  grid-template-rows:
    [presence] var(--image4-rhythm-presence)
    [dial] var(--image4-rhythm-dial)
    [greeting] var(--image4-rhythm-greeting)
    [actions] var(--image4-rhythm-actions)
    [composer] var(--image4-rhythm-composer);
}
html[data-theme='warm-day'] .panel-window--image4 .image4-chat {
  --image4-row-boundary-line: color-mix(in srgb, var(--image4-companion-border) 74%, transparent);
  --image4-weight-actions-border: color-mix(in srgb, var(--image4-companion-border) 52%, transparent);
  --image4-weight-actions-hover-border: color-mix(in srgb, var(--image4-companion-primary) 32%, transparent);
  --image4-state-focus-border: color-mix(in srgb, var(--image4-companion-secondary) 52%, transparent);
  --image4-state-hover-primary-bg: color-mix(in srgb, var(--image4-companion-secondary) 18%, transparent);
}
html[data-theme='warm-day'] .panel-window--image4 .companion-presence__dial-layer--base {
  background: radial-gradient(circle, var(--image4-companion-surface), var(--image4-companion-surface-strong), var(--image4-companion-primary-soft));
}
html[data-theme='warm-day'] .panel-window--image4 .companion-presence__dial strong {
  color: var(--image4-companion-text);
}
.panel-window--image4 .image4-presence { grid-row: presence; }
.panel-window--image4 .image4-presence {
  border: 0;
  background: transparent;
  box-shadow: none;
}
.panel-window--image4 .image4-dial-stage { grid-row: dial; }
.panel-window--image4 .companion-presence__signal {
  pointer-events: none;
  opacity: 0.24;
}
html[data-theme='warm-day'] .panel-window--image4 .companion-presence__signal {
  opacity: 0.22;
}
.panel-window--image4 .image4-chat[data-companion-mode='attentive'] .companion-presence__signal {
  opacity: var(--image4-presence-pulse);
}
.panel-window--image4 .image4-chat[data-companion-mode='resting'] .companion-presence__signal {
  opacity: var(--image4-presence-pulse);
}
.panel-window--image4 .companion-presence__signal.is-idle::before {
  background: linear-gradient(90deg, rgba(255, 190, 150, 0), rgba(255, 190, 150, 0.08), rgba(255, 200, 170, 0.09));
}
.panel-window--image4 .companion-presence__signal.is-idle .companion-presence__signal-bar {
  opacity: 0.14;
  transform: scaleY(0.32);
  animation: none;
}
.panel-window--image4 .companion-presence__signal.is-speaking {
  opacity: 0.82;
}
.panel-window--image4 .companion-presence__signal.is-speaking .companion-presence__signal-bar {
  animation: image4-wave-bar 2s ease infinite;
}
.panel-window--image4 .image4-chat[data-companion-mode='speaking'] .companion-presence__dial {
  opacity: var(--image4-dial-emphasis);
}
.panel-window--image4 .image4-chat[data-companion-mode='speaking'] .companion-presence__dial-voice { opacity: 1; }
.panel-window--image4 .image4-chat[data-companion-mode='speaking'] .companion-presence__dial-voice-ring { animation: image4-dial-voice-ring 2.7s ease-in-out infinite; }
.panel-window--image4 .image4-chat[data-companion-mode='resting'] .companion-presence__dial {
  opacity: var(--image4-dial-emphasis);
}
.panel-window--image4 .companion-presence__signal-bar::after { content: none; }
.panel-window--image4 .companion-presence__signal.is-speaking .companion-presence__signal-bar::after { content: none; }
.panel-window--image4 .companion-presence__dial .companion-presence__dial-meta {
  display: grid;
  justify-items: center;
  overflow: hidden;
}
.panel-window--image4 .companion-presence__dial .companion-presence__dial-meta span {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.panel-window--image4 .companion-presence__dial .companion-presence__dial-meta span + span {
  color: rgba(255, 213, 145, 0.62);
}
.panel-window--image4 .companion-presence__dial::before {
  animation: image4-dial-ticks 48s linear infinite;
}
.panel-window--image4 .companion-presence__dial-layer--arc {
  animation: image4-dial-arc 28s linear infinite;
}
.panel-window--image4 .companion-presence__signal::after { content: none; }
@media (min-aspect-ratio: 1 / 1) {
  .panel-window--image4 .image4-chat,
  html[data-theme='warm-day'] .panel-window--image4 .image4-chat {
    --image4-rhythm-dial: clamp(148px, 62cqw, 196px);
    --image4-rhythm-actions: clamp(152px, 58cqw, 198px);
  }
  .panel-window--image4 .companion-presence__copy strong {
    font-size: clamp(13px, 6.5cqw, 21px);
  }
  .panel-window--image4 .companion-presence__signal {
    height: clamp(20px, 9cqw, 32px);
  }
  .panel-window--image4 .companion-presence__dial {
    width: min(clamp(148px, 62cqw, 196px), calc(var(--image4-rhythm-dial) - 4px));
  }
  .panel-window--image4 .companion-presence__dial strong {
    font-size: clamp(24px, 12cqw, 34px);
  }
  .panel-window--image4 .companion-presence__dial .companion-presence__dial-meta {
    font-size: clamp(7px, 2.7cqw, 9.5px);
  }
}
`,
  'src/app/styles/panel-companion-messages.css': `.panel-window--image4 .image4-message-list, html[data-theme='warm-day'] .panel-window--image4 .image4-message-list { grid-row: greeting / actions; }
.panel-window--image4 .image4-message-list:not(.is-empty) { grid-row: greeting / composer; } .panel-window--image4 .message-bubble { width: fit-content; } .panel-window--image4 .message-bubble.user { justify-self: end; }
/* Xinghui companion palette for active chat density. */
html[data-theme='warm-day'] .panel-window--image4 .message-bubble { border-color: var(--image4-companion-border); background: var(--image4-companion-surface); color: var(--image4-companion-text); }
html[data-theme='warm-day'] .panel-window--image4 .message-bubble.user { border-color: var(--image4-companion-secondary); background: var(--image4-companion-surface-strong); }
html[data-theme='warm-day'] .panel-window--image4 .message-bubble__label { color: var(--image4-companion-muted); }`,
  'src/app/styles/panel-companion-chat.css': `
.panel-window--image4 .image4-greeting,
html[data-theme='warm-day'] .panel-window--image4 .image4-greeting {
  grid-row: greeting;
  padding: var(--image4-row-buffer-y) clamp(16px, 4vw, 42px) 0;
  transform: none;
}
html[data-theme='warm-day'] .panel-window--image4 .empty-chat__copy > strong {
  color: var(--image4-companion-text);
}
.panel-window--image4 .image4-action-list {
  grid-row: actions;
  grid-auto-rows: minmax(clamp(58px, 6.2vh, 72px), max-content);
  align-content: center;
  gap: clamp(2px, 0.5vh, 6px);
  border-top: 1px solid var(--image4-row-boundary-line);
  transform: none;
}
.panel-window--image4 .image4-action-list::before {
  content: none;
}
.panel-window--image4 .image4-action {
  grid-template-columns: clamp(34px, 6.6vw, 48px) minmax(0, 1fr) clamp(16px, 2.5vw, 24px);
  gap: clamp(10px, 2.1vw, 18px);
  min-height: clamp(58px, 6.2vh, 72px);
  padding: clamp(4px, 0.8vw, 7px) clamp(7px, 1.3vw, 10px);
  background: var(--image4-weight-actions-surface);
}
.panel-window--image4 .empty-chat__prompt-icon {
  width: clamp(30px, 5.4vw, 44px);
  height: clamp(30px, 5.4vw, 44px);
}
.panel-window--image4 .empty-chat__prompt-icon svg {
  width: clamp(17px, 3.2vw, 25px);
  height: clamp(17px, 3.2vw, 25px);
}
.panel-window--image4 .empty-chat__prompt-copy span {
  font-size: clamp(13px, 2.35vw, 20px);
}
.panel-window--image4 .empty-chat__prompt-copy small {
  font-size: clamp(10.5px, 2vw, 16px);
  -webkit-line-clamp: 1;
}
.panel-window--image4 .image4-action::after,
html[data-theme='warm-day'] .panel-window--image4 .image4-action::after {
  color: rgba(218, 227, 242, 0.34);
  font-size: clamp(20px, 3.4vw, 30px);
}
html[data-theme='warm-day'] .panel-window--image4 .composer__hint {
  color: var(--image4-companion-muted);
}
.panel-window--image4 .image4-action:hover {
  background: var(--image4-weight-actions-hover);
}
.panel-window--image4 .image4-action:focus-visible {
  border-color: var(--image4-state-focus-border);
  box-shadow: var(--image4-state-focus-ring);
}
.panel-window--image4 .image4-composer {
  grid-row: composer;
  padding: var(--image4-row-buffer-y) 0 0;
  background: transparent;
  box-shadow: none;
  transform: none;
}
.panel-window--image4 .image4-action,
html[data-theme='warm-day'] .panel-window--image4 .image4-action {}
.panel-window--image4 .image4-action:hover,
html[data-theme='warm-day'] .panel-window--image4 .image4-action:hover { transform: none; }
@media (min-aspect-ratio: 1 / 1) {
  .panel-window--image4 .empty-chat__copy > strong,
  html[data-theme='warm-day'] .panel-window--image4 .empty-chat__copy > strong {
    font-size: clamp(18px, 8.5cqw, 26px);
  }
  .panel-window--image4 .image4-action-list {
    grid-auto-rows: minmax(clamp(44px, 16cqw, 58px), max-content);
  }
  .panel-window--image4 .image4-action,
  html[data-theme='warm-day'] .panel-window--image4 .image4-action {
    grid-template-columns: clamp(26px, 11cqw, 36px) minmax(0, 1fr) clamp(14px, 5cqw, 18px);
  }
  .panel-window--image4 .empty-chat__prompt-copy span,
  html[data-theme='warm-day'] .panel-window--image4 .empty-chat__prompt-copy span {
    font-size: clamp(12px, 4.8cqw, 16px);
  }
}
`,
  'src/app/styles/panel-companion-rhythm.css': `
.panel-window--image4 .image4-rhythm-grid {
  opacity: 0.24;
  pointer-events: none;
  grid-template-rows:
    [presence] var(--image4-rhythm-presence)
    [dial] var(--image4-rhythm-dial)
    [greeting] var(--image4-rhythm-greeting)
    [actions] var(--image4-rhythm-actions)
    [composer] var(--image4-rhythm-composer);
}
.panel-window--image4 .image4-chat.is-image4-snapshot .image4-rhythm-grid { display: none; }
.panel-window--image4 .image4-rhythm-grid__row::after { content: none; }
.panel-window--image4 .image4-rhythm-grid__rail {
  right: -23px;
  width: 20px;
  opacity: 0.66;
}
`,
  'src/app/styles/panel-companion-motion.css': `
@keyframes image4-wave-bar-reduced { 0%, 100% { transform: scaleY(0.58); } 50% { transform: scaleY(0.68); } }
@media (prefers-reduced-motion: reduce) {
  .panel-window--image4 .companion-presence__signal::before,
  .panel-window--image4 .companion-presence__signal::after {
    animation: none !important;
    transition: none;
  }
  .panel-window--image4 .companion-presence__signal,
  .panel-window--image4 .companion-presence__signal-bar,
  .panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button,
  .panel-window--image4 .image4-attachment-pill,
  .panel-window--image4 .composer textarea,
  .panel-window--image4 .composer__actions .ghost-button,
  .panel-window--image4 .composer__actions .primary-button {
    transition-duration: 0ms;
  }
  .panel-window--image4 .companion-presence__signal-bar,
  .panel-window--image4 .companion-presence__signal.is-speaking .companion-presence__signal-bar,
  .panel-window--image4 .companion-presence__signal.is-speaking .companion-presence__signal-bar.is-live,
  .panel-window--image4 .image4-chat[data-companion-mode='speaking'] .companion-presence__signal.is-speaking .companion-presence__signal-bar,
  .panel-window--image4 .image4-chat[data-companion-mode='attentive'] .companion-presence__signal-bar {
    animation: none !important;
    animation-play-state: paused !important;
  }
  .panel-window--image4 .companion-presence__signal.is-speaking .companion-presence__signal-bar {
    opacity: var(--image4-motion-reduced-signal-opacity);
    transform: scaleY(0.58);
  }
}
@media (max-height: 760px) {
  .panel-window--image4 .empty-chat__prompt-copy small { -webkit-line-clamp: 1; }
}
@media (min-aspect-ratio: 1 / 1) and (max-height: 760px) {
  .panel-window--image4 .image4-chat,
  html[data-theme='warm-day'] .panel-window--image4 .image4-chat {
    --image4-rhythm-dial: clamp(120px, 54cqw, 166px);
    --image4-rhythm-actions: clamp(140px, 56cqw, 186px);
    --image4-rhythm-composer: clamp(58px, 21cqw, 76px);
  }
}
@media (max-height: 620px) {
  .panel-window--image4 .image4-chat { --image4-rhythm-dial: 0px; }
  .panel-window--image4 .image4-dial-stage { display: none; }
}
@media (min-aspect-ratio: 1 / 1) and (max-height: 620px) {
  .panel-window--image4 .image4-chat,
  html[data-theme='warm-day'] .panel-window--image4 .image4-chat {
    --image4-rhythm-dial: 0px;
    --image4-rhythm-actions: clamp(148px, 58cqw, 190px);
    --image4-rhythm-padding-top: clamp(12px, 5cqw, 18px);
  }
  .panel-window--image4 .image4-greeting,
  html[data-theme='warm-day'] .panel-window--image4 .image4-greeting {
    align-self: start;
  }
  .panel-window--image4 .empty-chat__copy > strong,
  html[data-theme='warm-day'] .panel-window--image4 .empty-chat__copy > strong {
    font-size: clamp(16px, 7cqw, 20px);
  }
  .panel-window--image4 .empty-chat p,
  html[data-theme='warm-day'] .panel-window--image4 .empty-chat p {
    -webkit-line-clamp: 2;
  }
}
`,
  'src/app/styles/panel-companion-final.css': `
.panel-window--image4 .image4-chat {
  grid-template-rows: 48px minmax(0, 1fr) auto 62px;
}
.panel-window--image4 .image4-live2d-stage { grid-row: 2; }
.panel-window--image4 .image4-conversation-recap { grid-row: 3; }
.panel-window--image4 .image4-message-list--archive { display: none !important; }
html[data-theme='warm-day'] .panel-window--image4 .image4-live2d-subtitle { background: rgba(255, 255, 255, 0.68); }
html[data-theme='warm-day'] .panel-window--image4 .image4-conversation-recap { background: rgba(255, 255, 255, 0.72); }
.panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button,
.panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button--settings,
.panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button--collapse,
.panel-window--image4 .panel-window__header-actions--image4 .panel-window__icon-button--danger {
  width: 32px !important;
  height: 32px !important;
  min-width: 32px !important;
  min-height: 32px !important;
}
`,
  'docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md': `
# Image4 Companion Field Reference Review

## Companion Color Strategy

The companionship palette should read as a calm presence system, not as a dashboard theme. Use warm off-white and soft cream as the dominant base, peach/apricot as the emotional warmth accent, and sage blue-green as the stabilizing trust accent. Text should stay warm dark brown or warm charcoal rather than pure black.

Avoid large areas of cold blue-gray, high-saturation orange/red, neon purple, or dark morning surfaces. Warm-day must remain visibly light and companion-like even when the chat has active messages; controls may use blue-green for focus, send-ready, online, and calm-support states, but the overall field should still feel warm.

## Companion Color Research Basis

This color direction is grounded in color-emotion research and accessibility rules, not only visual taste. A 2025 Psychonomic Bulletin & Review systematic review of 132 peer-reviewed articles reports that light colors skew positive, while blue, green, blue-green, and white are associated with positive low-arousal emotions such as comfort and relaxation. It also warns that yellow/orange tend toward higher arousal, so Nexus should use peach/apricot as a restrained emotional accent instead of a broad high-energy theme.

For controls, the W3C non-text contrast guidance is the guardrail: available UI controls and meaningful icons need enough adjacent contrast to be identifiable, while inactive controls can stay quieter. In Image4 warm-day this means embedded plus, mic, send-ready, focus, and speaking cues should be legible through companion tokens before adding tiles, shadows, or larger button boxes.
`,
}
function createImage4VisualContractFixture(overrides: Record<string, string | null> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-image4-visual-contract-audit-'))
  for (const [relativePath, baseline] of Object.entries(BASELINE_FILES)) {
    if (overrides[relativePath] === null) continue
    const absolutePath = join(root, relativePath)
    mkdirSync(join(absolutePath, '..'), { recursive: true })
    writeFileSync(absolutePath, overrides[relativePath] ?? baseline)
  }
  return root
}
function withImage4VisualContractFixture<T>(
  overrides: Record<string, string | null>,
  callback: (root: string) => T,
): T {
  const root = createImage4VisualContractFixture(overrides)
  try {
    return callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
function readWorkspaceFile(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8')
}
function assertContains(source: string, snippet: string, message: string) {
  assert.ok(source.includes(snippet), message)
}
type Image4VisualContractReport = ReturnType<typeof buildImage4VisualContractReport>
function assertMissingContract(report: Image4VisualContractReport, id: string) {
  assert.ok(report.errors.missingContracts.some((item) => item.id === id))
}
test('image4 visual contract audit passes the protected Image4 structure', () => {
  withImage4VisualContractFixture({}, (root) => {
    const report = buildImage4VisualContractReport(root)
    assert.equal(report.summary.ok, true)
    assert.equal(report.summary.errors, 0)
    assert.equal(report.privacy.staticSourceOnly, true)
  })
})
test('image4 visual contract audit keeps rule definitions split from the runner', () => {
  const auditRunner = readWorkspaceFile('scripts/image4-visual-contract-audit.mjs')
  const auditRules = readWorkspaceFile('scripts/image4-visual-contract-rules.mjs')
  assertContains(auditRunner, "from './image4-visual-contract-rules.mjs'", 'audit runner should import shared rule definitions')
  assertContains(auditRules, 'export const REQUIRED_CONTRACTS', 'rule module should own Image4 required contracts')
  assertContains(auditRules, 'export const FORBIDDEN_PATTERNS', 'rule module should own Image4 forbidden patterns')
})
test('image4 visual contract audit rejects missing companion color strategy', () => {
  withImage4VisualContractFixture({
    'docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md': BASELINE_FILES['docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md'].replace(
      'sage blue-green as the stabilizing trust accent',
      'blue as the accent',
    ),
  }, (root) => {
    const report = buildImage4VisualContractReport(root)
    assert.equal(report.summary.ok, false)
    assertMissingContract(report, 'companion-color-strategy-recorded')
  })
})
test('image4 visual contract audit rejects weak embedded composer tool contrast', () => {
  withImage4VisualContractFixture({
    'src/app/styles/panel-companion-composer.css': BASELINE_FILES['src/app/styles/panel-companion-composer.css'].replace(
      'color: color-mix(in srgb, var(--image4-companion-muted) 88%, var(--image4-companion-text));',
      'color: color-mix(in srgb, var(--image4-companion-muted) 78%, transparent);',
    ),
  }, (root) => {
    const report = buildImage4VisualContractReport(root)
    assert.equal(report.summary.ok, false)
    assertMissingContract(report, 'warm-day-embedded-tool-contrast-without-tiles')
  })
})
test('image4 visual contract audit rejects missing Image4 field component boundary', () => {
  withImage4VisualContractFixture({
    'src/app/views/Image4CompanionField.tsx': BASELINE_FILES['src/app/views/Image4CompanionField.tsx'].replace(
      '<Image4Signal active={signalActive} />',
      '',
    ),
  }, (root) => {
    const report = buildImage4VisualContractReport(root)
    assert.equal(report.summary.ok, false)
    assertMissingContract(report, 'image4-companion-field-component-boundary')
  })
})
test('image4 visual contract audit rejects inlined signal bars in PanelView', () => {
  withImage4VisualContractFixture({
    'src/app/views/LegacyPanelView.tsx': `${BASELINE_FILES['src/app/views/LegacyPanelView.tsx']}
const bars = Array.from({ length: 64 }, (_, index) => index)
`,
  }, (root) => {
    const report = buildImage4VisualContractReport(root)
    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.forbiddenPatterns.some((item) => item.id === 'panel-view-inline-signal-bars'),
    )
  })
})
test('image4 hard contract check ignores soft visual strategy drift', () => {
  withImage4VisualContractFixture({
    'src/app/styles/panel-companion-chat.css': BASELINE_FILES['src/app/styles/panel-companion-chat.css'].replace(
      'transform: none;',
      'transform: translateY(-1px);',
    ),
    'src/app/styles/panel-companion-composer.css': BASELINE_FILES['src/app/styles/panel-companion-composer.css'].replace(
      "html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field textarea::placeholder",
      "html[data-theme='warm-day'] .image4-composer__field textarea::placeholder",
    ),
  }, (root) => {
    const report = buildImage4VisualContractReport(root, { mode: 'hard' })
    assert.equal(report.summary.ok, true)
    assert.equal(report.summary.errors, 0)
    assert.equal(report.errors.unsafeTransforms.length, 0)
  })
})
test('image4 visual contract audit rejects missing warm-day placeholder specificity', () => {
  withImage4VisualContractFixture({
    'src/app/styles/panel-companion-composer.css': BASELINE_FILES['src/app/styles/panel-companion-composer.css'].replace(
      "html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field textarea::placeholder",
      "html[data-theme='warm-day'] .image4-composer__field textarea::placeholder",
    ),
  }, (root) => {
    const report = buildImage4VisualContractReport(root)
    assert.equal(report.summary.ok, false)
    assertMissingContract(report, 'warm-day-image4-composer-specificity')
  })
})
test('image4 visual contract audit rejects loud rhythm-grid overlays', () => {
  withImage4VisualContractFixture({
    'src/app/styles/panel-companion-rhythm.css': BASELINE_FILES['src/app/styles/panel-companion-rhythm.css']
      .replace('opacity: 0.24;', 'opacity: 0.34;')
      .replace('opacity: 0.66;', 'opacity: 1;'),
  }, (root) => {
    const report = buildImage4VisualContractReport(root)
    assert.equal(report.summary.ok, false)
    assertMissingContract(report, 'rhythm-overlay-does-not-cover-content')
  })
})
test('image4 visual contract audit rejects oversized Image4 top controls', () => {
  withImage4VisualContractFixture({
    'src/app/styles/panel-companion-shell.css': BASELINE_FILES['src/app/styles/panel-companion-shell.css'].replaceAll(
      'clamp(24px, 3.8vw, 34px)',
      'clamp(26px, 6.35vw, 54px)',
    ),
  }, (root) => {
    const report = buildImage4VisualContractReport(root)
    assert.equal(report.summary.ok, false)
    assertMissingContract(report, 'image4-top-controls-compact-scale')
  })
})
test('image4 visual contract audit rejects same-tone Image4 top controls', () => {
  withImage4VisualContractFixture({
    'src/app/styles/panel-companion-shell.css': BASELINE_FILES['src/app/styles/panel-companion-shell.css']
      .replace('color: rgba(214, 228, 255, 0.78);', 'color: rgba(203, 220, 244, 0.7);')
      .replace('color: rgba(255, 213, 145, 0.66);', 'color: rgba(203, 220, 244, 0.7);')
      .replace('color: rgba(255, 174, 174, 0.62);', 'color: rgba(203, 220, 244, 0.7);'),
  }, (root) => {
    const report = buildImage4VisualContractReport(root)
    assert.equal(report.summary.ok, false)
    assertMissingContract(report, 'image4-top-controls-functional-tones')
  })
})
test('image4 visual contract audit rejects signal activation outside speaking state', () => {
  withImage4VisualContractFixture({
    'src/app/views/image4CompanionState.ts': BASELINE_FILES['src/app/views/image4CompanionState.ts']
      .replaceAll('signalActive: false', 'signalActive: true'),
  }, (root) => {
    const report = buildImage4VisualContractReport(root)
    assert.equal(report.summary.ok, false)
    assertMissingContract(report, 'signal-active-only-while-speaking')
  })
})
test('image4 visual contract audit rejects missing elapsed bucket state input', () => {
  withImage4VisualContractFixture({
    'src/app/views/LegacyPanelView.tsx': BASELINE_FILES['src/app/views/LegacyPanelView.tsx'].replace(
      '    elapsedBucket: image4ElapsedBucket,\n',
      '',
    ),
  }, (root) => {
    const report = buildImage4VisualContractReport(root)
    assert.equal(report.summary.ok, false)
    assertMissingContract(report, 'image4-single-companion-state-driver')
  })
})
test('image4 visual contract audit rejects missing URL state preview input', () => {
  withImage4VisualContractFixture({
    'src/app/views/LegacyPanelView.tsx': BASELINE_FILES['src/app/views/LegacyPanelView.tsx'].replace(
      '    statePreview: image4StatePreview,\n',
      '',
    ),
  }, (root) => {
    const report = buildImage4VisualContractReport(root)
    assert.equal(report.summary.ok, false)
    assertMissingContract(report, 'image4-single-companion-state-driver')
  })
})
test('image4 visual contract audit rejects loud idle voice signal', () => {
  withImage4VisualContractFixture({
    'src/app/styles/panel-companion-layout.css': BASELINE_FILES['src/app/styles/panel-companion-layout.css']
      .replace('opacity: 0.24;', 'opacity: 0.55;')
      .replace('rgba(255, 190, 150, 0.08)', 'rgba(255, 190, 150, 0.16)')
      .replace('rgba(255, 200, 170, 0.09)', 'rgba(255, 200, 170, 0.18)')
      .replace('opacity: 0.14;', 'opacity: 0.26;')
      .replace('transform: scaleY(0.32);', 'transform: scaleY(0.42);'),
  }, (root) => {
    const report = buildImage4VisualContractReport(root)
    assert.equal(report.summary.ok, false)
    assertMissingContract(report, 'signal-idle-stays-low-noise')
  })
})
test('image4 visual contract audit rejects animated idle voice signal', () => {
  withImage4VisualContractFixture({
    'src/app/styles/panel-companion-layout.css': BASELINE_FILES['src/app/styles/panel-companion-layout.css'].replace(
      'animation: none;',
      'animation: image4-wave-bar 2s ease infinite;',
    ),
  }, (root) => {
    const report = buildImage4VisualContractReport(root)
    assert.equal(report.summary.ok, false)
    assertMissingContract(report, 'signal-idle-stays-low-noise')
  })
})
test('image4 visual contract audit rejects expanded Image4 identity copy', () => {
  withImage4VisualContractFixture({
    'src/app/views/LegacyPanelView.tsx': `${BASELINE_FILES['src/app/views/LegacyPanelView.tsx']}
const image4ExpandedIdentity = '星绘在身边'
`,
  }, (root) => {
    const report = buildImage4VisualContractReport(root)
    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.forbiddenPatterns.some((item) => item.id === 'expanded-presence-copy-returned'),
    )
  })
})
test('image4 visual contract audit rejects interactive presence header', () => {
  withImage4VisualContractFixture({
    'src/app/views/Image4CompanionField.tsx': BASELINE_FILES['src/app/views/Image4CompanionField.tsx'].replace(
      '<section className="companion-presence image4-presence">',
      '<section className="companion-presence image4-presence" role="button" tabIndex={0} onClick={openPresence}>',
    ),
  }, (root) => {
    const report = buildImage4VisualContractReport(root)
    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.forbiddenPatterns.some((item) => item.id === 'presence-interaction-returned'),
    )
  })
})
test('image4 visual contract audit rejects leading identity orb selectors', () => {
  withImage4VisualContractFixture({
    'src/app/styles/panel-companion-layout.css': `${BASELINE_FILES['src/app/styles/panel-companion-layout.css']}
.panel-window--image4 .companion-presence__identity::before {
  content: "";
}
`,
  }, (root) => {
    const report = buildImage4VisualContractReport(root)
    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.forbiddenPatterns.some((item) => item.id === 'identity-leading-orb-returned'),
    )
  })
})
test('image4 hard contract rejects retired dial markup returning', () => {
  withImage4VisualContractFixture({
    'src/app/views/LegacyPanelView.tsx': `${BASELINE_FILES['src/app/views/LegacyPanelView.tsx']}\nconst retired = <Image4Dial />\n`,
  }, (root) => {
    const report = buildImage4VisualContractReport(root, { mode: 'hard' })
    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.forbiddenPatterns.some((item) => item.id === 'retired-panel-elements-returned'),
    )
  })
})
test('image4 visual contract audit rejects blurred voice-bar overlay', () => {
  withImage4VisualContractFixture({
    'src/app/styles/panel-companion-layout.css': BASELINE_FILES['src/app/styles/panel-companion-layout.css'].replace(
      '.panel-window--image4 .companion-presence__signal-bar::after { content: none; }',
      '.panel-window--image4 .companion-presence__signal-bar::after { content: ""; filter: blur(0.8px); }',
    ),
  }, (root) => {
    const report = buildImage4VisualContractReport(root)
    assert.equal(report.summary.ok, false)
    assertMissingContract(report, 'signal-bars-have-no-blur-overlay')
  })
})
test('image4 visual contract audit rejects multi-property signal keyframes', () => {
  withImage4VisualContractFixture({
    'src/app/styles/panel-companion-motion.css': BASELINE_FILES['src/app/styles/panel-companion-motion.css'].replace(
      '0%, 100% { transform: scaleY(0.58); }',
      '0%, 100% {\n    opacity: 0.5; transform: scaleY(0.58); }',
    ),
  }, (root) => {
    const report = buildImage4VisualContractReport(root)
    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.signalAnimationLeaks.some((item) => item.selector === '@keyframes image4-wave-bar-reduced'),
    )
  })
})
test('image4 visual contract audit rejects hover transform jumps', () => {
  withImage4VisualContractFixture({
    'src/app/styles/panel-companion-chat.css': BASELINE_FILES['src/app/styles/panel-companion-chat.css'].replace(
      "html[data-theme='warm-day'] .panel-window--image4 .image4-action:hover { transform: none; }",
      "html[data-theme='warm-day'] .panel-window--image4 .image4-action:hover { transform: translateY(-1px); }",
    ),
  }, (root) => {
    const report = buildImage4VisualContractReport(root)
    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.unsafeTransforms.some((item) => item.transform === 'translateY(-1px)'))
  })
})
test('image4 visual contract audit rejects presence wrapper elevation', () => {
  withImage4VisualContractFixture({
    'src/app/styles/panel-companion-layout.css': `${BASELINE_FILES['src/app/styles/panel-companion-layout.css']}
.panel-window--image4 .companion-presence__signal.is-speaking {
  filter: drop-shadow(0 0 12px rgba(255, 170, 120, 0.2));
  animation: image4-signal-breathe 3s ease infinite;
}
`,
  }, (root) => {
    const report = buildImage4VisualContractReport(root)
    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.presenceWeightLeaks.some((item) => item.selector.includes('is-speaking')))
  })
})
test('image4 visual contract audit rejects recap hover weight elevation', () => {
  withImage4VisualContractFixture({
    'src/app/styles/panel-companion-chat.css': `${BASELINE_FILES['src/app/styles/panel-companion-chat.css']}
.panel-window--image4 .image4-conversation-recap:hover {
  box-shadow: 0 10px 26px rgba(111, 226, 239, 0.22);
}
`,
  }, (root) => {
    const report = buildImage4VisualContractReport(root)
    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.visualWeightLeaks.some((item) => item.selector.includes('image4-conversation-recap:hover')))
  })
})
test('image4 visual contract audit rejects row container negative vertical shifts', () => {
  withImage4VisualContractFixture({
    'src/app/styles/panel-companion-chat.css': `${BASELINE_FILES['src/app/styles/panel-companion-chat.css']}
.panel-window--image4 .image4-conversation-recap { transform: translateY(-6px); }
`,
  }, (root) => {
    const report = buildImage4VisualContractReport(root)
    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.rowBoundaryLeaks.some((item) => item.selector.includes('image4-conversation-recap')))
  })
})
test('image4 visual contract audit rejects wrapper state mutation leaks', () => {
  withImage4VisualContractFixture({
    'src/app/styles/panel-companion-chat.css': `${BASELINE_FILES['src/app/styles/panel-companion-chat.css']}
.panel-window--image4 .image4-conversation-recap:hover {
  z-index: 3;
  filter: drop-shadow(0 0 12px rgba(111, 226, 239, 0.2));
}
`,
  }, (root) => {
    const report = buildImage4VisualContractReport(root)
    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.interactionStateLeaks.some((item) => item.selector.includes('image4-conversation-recap:hover')))
  })
})
test('image4 hard contract check ignores soft presence weight drift', () => {
  withImage4VisualContractFixture({
    'src/app/styles/panel-companion-layout.css': `${BASELINE_FILES['src/app/styles/panel-companion-layout.css']}
.panel-window--image4 .companion-presence__signal.is-speaking {
  filter: drop-shadow(0 0 12px rgba(255, 170, 120, 0.2));
}
`,
  }, (root) => {
    const report = buildImage4VisualContractReport(root, { mode: 'hard' })
    assert.equal(report.summary.ok, true)
    assert.equal(report.errors.presenceWeightLeaks.length, 0)
  })
})
test('image4 hard contract rejects infinite speaking signal under reduced motion', () => {
  withImage4VisualContractFixture({
    'src/app/styles/panel-companion-motion.css': BASELINE_FILES['src/app/styles/panel-companion-motion.css']
      .replaceAll('animation: none !important;', 'animation: image4-wave-bar-reduced 900ms ease-out infinite;')
      .replaceAll('animation-play-state: paused !important;', 'animation-play-state: running;'),
  }, (root) => {
    const report = buildImage4VisualContractReport(root, { mode: 'hard' })
    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.missingContracts.some((item) => item.id === 'reduced-motion-stops-speaking-signal-animation'),
    )
  })
})
test('image4 hard contract check ignores soft visual weight and row-boundary drift', () => {
  withImage4VisualContractFixture({
    'src/app/styles/panel-companion-chat.css': `${BASELINE_FILES['src/app/styles/panel-companion-chat.css']}
.panel-window--image4 .image4-conversation-recap:hover {
  box-shadow: 0 10px 26px rgba(111, 226, 239, 0.22);
}
`,
  }, (root) => {
    const report = buildImage4VisualContractReport(root, { mode: 'hard' })
    assert.equal(report.summary.ok, true)
    assert.equal(report.errors.visualWeightLeaks.length, 0)
    assert.equal(report.errors.rowBoundaryLeaks.length, 0)
  })
})
test('image4 hard contract check ignores soft interaction-state drift', () => {
  withImage4VisualContractFixture({
    'src/app/styles/panel-companion-chat.css': `${BASELINE_FILES['src/app/styles/panel-companion-chat.css']}
.panel-window--image4 .image4-conversation-recap:hover {
  z-index: 3;
  filter: drop-shadow(0 0 12px rgba(111, 226, 239, 0.2));
}
`,
  }, (root) => {
    const report = buildImage4VisualContractReport(root, { mode: 'hard' })
    assert.equal(report.summary.ok, true)
    assert.equal(report.errors.interactionStateLeaks.length, 0)
  })
})
