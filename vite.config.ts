import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const settingsSectionChunks = [
  {
    name: 'settings-section-console',
    files: [
      '/src/components/settingsSections/ConsoleSection.tsx',
      '/src/components/settingsSections/AboutPanel.tsx',
      '/src/components/settingsSections/CostHistoryPanel.tsx',
      '/src/components/settingsSections/DiagnosticsPanel.tsx',
      '/src/components/settingsSections/StateTimelinePanel.tsx',
      '/src/components/settingsSections/UpdaterPanel.tsx',
      '/src/components/settingsSections/WeeklyRecapPanel.tsx',
      '/src/components/settingsSections/ContextSection.tsx',
    ],
  },
  {
    name: 'settings-section-voice',
    files: [
      '/src/components/settingsSections/VoiceSection.tsx',
      '/src/components/settingsSections/SpeechInputSection.tsx',
      '/src/components/settingsSections/SpeechOutputSection.tsx',
    ],
  },
  { name: 'settings-section-model', files: ['/src/components/settingsSections/ModelSection.tsx'] },
  { name: 'settings-section-chat', files: ['/src/components/settingsSections/ChatSection.tsx'] },
  { name: 'settings-section-history', files: ['/src/components/settingsSections/HistorySection.tsx'] },
  { name: 'settings-section-memory', files: ['/src/components/settingsSections/MemorySection.tsx'] },
  { name: 'settings-section-lorebooks', files: ['/src/components/settingsSections/LorebooksSection.tsx'] },
  { name: 'settings-section-window', files: ['/src/components/settingsSections/WindowSection.tsx'] },
  { name: 'settings-section-integrations', files: ['/src/components/settingsSections/IntegrationsSection.tsx'] },
  { name: 'settings-section-tools', files: ['/src/components/settingsSections/ToolsSection.tsx'] },
  { name: 'settings-section-autonomy', files: ['/src/components/settingsSections/AutonomySection.tsx'] },
  { name: 'settings-section-shared', files: ['/src/components/settingsSections/UrlInput.tsx'] },
]

function resolveSettingsSectionChunk(normalizedId: string) {
  return settingsSectionChunks.find((chunk) => (
    chunk.files.some((file) => normalizedId.includes(file))
  ))?.name
}

function resolveManualChunk(id: string) {
  const normalizedId = id.replace(/\\/g, '/')

  // ── vendor chunks ──────────────────────────────────────────────
  if (normalizedId.includes('node_modules/react/')
    || normalizedId.includes('node_modules/react-dom/')
    || normalizedId.includes('node_modules/scheduler/')) {
    return 'react-vendor'
  }

  if (normalizedId.includes('node_modules/@huggingface/transformers/')) {
    return 'transformers-vendor'
  }

  if (normalizedId.includes('node_modules/onnxruntime-web/')) {
    return 'ort-vendor'
  }

  if (normalizedId.includes('node_modules/pinyin-pro/')) {
    return 'chinese-vendor'
  }

  if (normalizedId.includes('node_modules/@ricky0123/vad-web/')) {
    return 'voice-vendor'
  }

  if (normalizedId.includes('node_modules/tesseract.js')) {
    return 'tesseract-vendor'
  }

  if (normalizedId.includes('/src/i18n/locales/en.ts')) {
    return 'locale-en-US'
  }

  if (normalizedId.includes('/src/i18n/locales/ja.ts')) {
    return 'locale-ja'
  }

  if (normalizedId.includes('/src/i18n/locales/ko.ts')) {
    return 'locale-ko'
  }

  if (normalizedId.includes('/src/i18n/locales/zh-TW.ts')) {
    return 'locale-zh-TW'
  }

  if (normalizedId.includes('/src/i18n/')) {
    return 'i18n-runtime'
  }

  // ── feature runtime chunks ─────────────────────────────────────
  if (normalizedId.includes('/src/features/hearing/')) {
    return 'hearing-runtime'
  }

  if (normalizedId.includes('/src/features/vision/')) {
    return 'vision-runtime'
  }

  if (normalizedId.includes('/src/features/autonomy/')) {
    return 'autonomy-runtime'
  }

  if (
    normalizedId.includes('/src/app/controllers/useAutonomy')
    || normalizedId.includes('/src/app/controllers/useEmotionState.ts')
    || normalizedId.includes('/src/app/controllers/useRelationshipState.ts')
    || normalizedId.includes('/src/app/controllers/useRhythmState.ts')
    || normalizedId.includes('/src/hooks/useAutonomyTick.ts')
    || normalizedId.includes('/src/hooks/useMemoryDream.ts')
  ) {
    return 'autonomy-runtime'
  }

  if (
    normalizedId.includes('/src/hooks/useAwayNotificationScheduler.ts')
    || normalizedId.includes('/src/hooks/useBracketScheduler.ts')
    || normalizedId.includes('/src/hooks/useErrandScheduler.ts')
    || normalizedId.includes('/src/hooks/useFutureCapsuleScheduler.ts')
    || normalizedId.includes('/src/hooks/useGuidanceAnalysisScheduler.ts')
    || normalizedId.includes('/src/hooks/useLetterScheduler.ts')
    || normalizedId.includes('/src/hooks/useOpenArcScheduler.ts')
    || normalizedId.includes('/src/hooks/useReminderScheduler.ts')
  ) {
    return 'scheduler-runtime'
  }

  // ── app runtime chunks ─────────────────────────────────────────
  if (
    normalizedId.includes('/src/hooks/useVoice.ts')
    || normalizedId.includes('/src/hooks/voice/')
    || normalizedId.includes('/src/features/voice/')
    || normalizedId.includes('/src/lib/audioProviders.ts')
    || normalizedId.includes('/src/lib/speechProviderProfiles.ts')
  ) {
    return 'voice-runtime'
  }

  if (
    normalizedId.includes('/src/hooks/useChat.ts')
    || normalizedId.includes('/src/features/chat/')
    || normalizedId.includes('/src/features/tools/')
    || normalizedId.includes('/src/features/memory/')
    || normalizedId.includes('/src/lib/apiProviders.ts')
    || normalizedId.includes('/src/lib/webSearchProviders.ts')
  ) {
    return 'assistant-runtime'
  }

  if (
    normalizedId.includes('/src/app/controllers/')
    || normalizedId.includes('/src/app/providers/')
    || normalizedId.includes('/src/hooks/useDesktopContext.ts')
    || normalizedId.includes('/src/hooks/usePetBehavior.ts')
    || normalizedId.includes('/src/hooks/useReminderScheduler.ts')
  ) {
    return 'app-runtime'
  }

  // ── UI chunks ──────────────────────────────────────────────────
  const settingsSectionChunk = resolveSettingsSectionChunk(normalizedId)
  if (settingsSectionChunk) {
    return settingsSectionChunk
  }

  if (
    normalizedId.includes('/src/components/SettingsDrawer')
    || normalizedId.includes('/src/components/settingsSectionLoaders.ts')
    || normalizedId.includes('/src/components/settingsDrawer')
    || normalizedId.includes('/src/components/settingsFields.tsx')
  ) {
    return 'settings-ui'
  }

  return undefined
}

const chunkGroups = [
  { name: 'react-vendor', test: (id: string) => resolveManualChunk(id) === 'react-vendor', priority: 100 },
  { name: 'transformers-vendor', test: (id: string) => resolveManualChunk(id) === 'transformers-vendor', priority: 100 },
  { name: 'ort-vendor', test: (id: string) => resolveManualChunk(id) === 'ort-vendor', priority: 100 },
  { name: 'chinese-vendor', test: (id: string) => resolveManualChunk(id) === 'chinese-vendor', priority: 100 },
  { name: 'voice-vendor', test: (id: string) => resolveManualChunk(id) === 'voice-vendor', priority: 100 },
  { name: 'tesseract-vendor', test: (id: string) => resolveManualChunk(id) === 'tesseract-vendor', priority: 100 },
  { name: 'locale-en-US', test: (id: string) => resolveManualChunk(id) === 'locale-en-US', priority: 95 },
  { name: 'locale-ja', test: (id: string) => resolveManualChunk(id) === 'locale-ja', priority: 95 },
  { name: 'locale-ko', test: (id: string) => resolveManualChunk(id) === 'locale-ko', priority: 95 },
  { name: 'locale-zh-TW', test: (id: string) => resolveManualChunk(id) === 'locale-zh-TW', priority: 95 },
  { name: 'i18n-runtime', test: (id: string) => resolveManualChunk(id) === 'i18n-runtime', priority: 90 },
  { name: 'hearing-runtime', test: (id: string) => resolveManualChunk(id) === 'hearing-runtime', priority: 70 },
  { name: 'vision-runtime', test: (id: string) => resolveManualChunk(id) === 'vision-runtime', priority: 70 },
  { name: 'autonomy-runtime', test: (id: string) => resolveManualChunk(id) === 'autonomy-runtime', priority: 70 },
  { name: 'scheduler-runtime', test: (id: string) => resolveManualChunk(id) === 'scheduler-runtime', priority: 60 },
  { name: 'voice-runtime', test: (id: string) => resolveManualChunk(id) === 'voice-runtime', priority: 60 },
  { name: 'assistant-runtime', test: (id: string) => resolveManualChunk(id) === 'assistant-runtime', priority: 60 },
  { name: 'app-runtime', test: (id: string) => resolveManualChunk(id) === 'app-runtime', priority: 40 },
  { name: 'settings-ui', test: (id: string) => resolveManualChunk(id) === 'settings-ui', priority: 30 },
  ...settingsSectionChunks.map((chunk) => ({
    name: chunk.name,
    test: (id: string) => resolveManualChunk(id) === chunk.name,
    priority: 25,
  })),
]

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [tailwindcss(), react()],
  build: {
    minify: 'esbuild',
    target: 'esnext',
    cssCodeSplit: true,
    // Remaining large chunks are optional local-ML runtimes that stay lazy.
    chunkSizeWarningLimit: 950,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: chunkGroups,
        },
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom'],
    exclude: ['@huggingface/transformers', 'onnxruntime-web'],
  },
  server: {
    host: '127.0.0.1',
    port: 47821,
    strictPort: true,
  },
})
