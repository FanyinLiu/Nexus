import { createRoot } from 'react-dom/client'
import '../index.css'
import App from './App.tsx'
import { AppProviders } from './providers'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { installConsoleCapture } from '../lib/logger'

// Capture every console.* call into the diagnostics ring buffer so the
// in-app "Copy to clipboard" button (Settings → Console → Diagnostics)
// surfaces lifecycle events from voice / TTS / chat without needing
// DevTools. Idempotent.
installConsoleCapture()

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <AppProviders>
      <App />
    </AppProviders>
  </ErrorBoundary>,
)
