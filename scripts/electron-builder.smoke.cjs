const pkg = require('../package.json')
const path = require('node:path')

const build = pkg.build || {}

module.exports = {
  ...build,
  electronDist: path.join(__dirname, '..', 'node_modules', 'electron', 'dist'),
  directories: {
    ...(build.directories || {}),
    output: process.env.PACKAGED_SMOKE_RELEASE_DIR || 'release-smoke',
  },
  publish: null,
  extraResources: [],
  win: {
    ...(build.win || {}),
    extraResources: [],
  },
  mac: {
    ...(build.mac || {}),
    extraResources: [],
  },
  linux: {
    ...(build.linux || {}),
    extraResources: [],
  },
}
