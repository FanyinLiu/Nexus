const pkg = require('../package.json')
const path = require('node:path')

const build = pkg.build || {}

module.exports = {
  ...build,
  appId: 'ai.factory.desktoppet.smoke',
  productName: 'Nexus Smoke',
  forceCodeSigning: false,
  electronDist: path.join(__dirname, '..', 'node_modules', 'electron', 'dist'),
  directories: {
    ...(build.directories || {}),
    output: process.env.PACKAGED_SMOKE_RELEASE_DIR || 'release-smoke',
  },
  publish: null,
  extraResources: [],
  electronFuses: {
    ...(build.electronFuses || {}),
    // Local smoke is intentionally unsigned and must not prompt for the
    // user's macOS Keychain while validating renderer/package startup.
    enableCookieEncryption: false,
  },
  win: {
    ...(build.win || {}),
    extraResources: [],
  },
  mac: {
    ...(build.mac || {}),
    // Smoke validates renderer/package loading without production signing
    // credentials. Release CI uses the package defaults and its signed gate.
    hardenedRuntime: false,
    gatekeeperAssess: false,
    notarize: false,
    extraResources: [],
  },
  linux: {
    ...(build.linux || {}),
    extraResources: [],
  },
}
