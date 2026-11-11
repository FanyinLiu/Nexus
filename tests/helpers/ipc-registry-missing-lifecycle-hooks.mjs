import { load as baseLoad, resolve as baseResolve } from './electron-main-stub-hooks.mjs'

const LIFECYCLE_PATH = '/electron/services/mediaPermissionLifecycle.js'

export async function resolve(specifier, context, nextResolve) {
  return baseResolve(specifier, context, nextResolve)
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(LIFECYCLE_PATH)) {
    return {
      format: 'module',
      shortCircuit: true,
      source: 'export const mediaPermissionLifecycle = undefined\n',
    }
  }
  return baseLoad(url, context, nextLoad)
}
