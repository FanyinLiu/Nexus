/**
 * Canonical update-check URLs — single source of truth shared by the
 * Electron main process (services/updatePolicy.js) and the Vite renderer
 * (features/updater/state.ts), which each kept a copy of this literal.
 */
export const NEXUS_GITHUB_RELEASES_URL = 'https://github.com/FanyinLiu/Nexus/releases/latest'
