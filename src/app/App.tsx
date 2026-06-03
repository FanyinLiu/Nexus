import { Component, Suspense, lazy } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import './App.css'
import { useAppController } from './controllers'
import { PetView, PanelView } from './views'
import { ModelSetupOverlay } from '../features/setup/components/ModelSetupOverlay'
import { t as translate } from '../i18n/runtime.ts'

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[App] Uncaught render error:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-error-fallback" role="alert">
          <div className="app-error-fallback__card">
            <span className="app-error-fallback__eyebrow">Nexus</span>
            <h1>{translate('app.error_boundary.title')}</h1>
            <p>{translate('app.error_boundary.body')}</p>
            <pre className="app-error-fallback__detail">{this.state.error.message}</pre>
            <button
              type="button"
              className="app-error-fallback__button"
              onClick={() => window.location.reload()}
            >
              {translate('app.error_boundary.reload')}
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

const SettingsDrawer = lazy(async () => {
  const module = await import('../components/SettingsDrawer')
  return { default: module.SettingsDrawer }
})

const OnboardingGuide = lazy(async () => {
  const module = await import('../features/onboarding/components/OnboardingGuide')
  return { default: module.OnboardingGuide }
})

function App() {
  const controller = useAppController()

  const onboardingGuide = controller.overlays.onboardingGuideProps.open ? (
    <Suspense fallback={null}>
      <OnboardingGuide {...controller.overlays.onboardingGuideProps} />
    </Suspense>
  ) : null

  const settingsDrawer = controller.overlays.settingsDrawerProps.open ? (
    <Suspense fallback={null}>
      <SettingsDrawer {...controller.overlays.settingsDrawerProps} />
    </Suspense>
  ) : null

  if (controller.view === 'pet') {
    return (
      <AppErrorBoundary>
        <PetView
          {...controller.petView}
          onboardingGuide={onboardingGuide}
        />
        {settingsDrawer}
        <ModelSetupOverlay suppressed />
      </AppErrorBoundary>
    )
  }

  return (
    <AppErrorBoundary>
      <PanelView
        {...controller.panelView}
        settingsDrawer={settingsDrawer}
        onboardingGuide={onboardingGuide}
      />
      <ModelSetupOverlay />
    </AppErrorBoundary>
  )
}

export default App
