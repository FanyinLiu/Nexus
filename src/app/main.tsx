import { createRoot } from 'react-dom/client'
import '../index.css'
import App from './App.tsx'
import { AppProviders } from './providers'
import { ErrorBoundary } from './ErrorBoundary.tsx'

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <AppProviders>
      <App />
    </AppProviders>
  </ErrorBoundary>,
)
