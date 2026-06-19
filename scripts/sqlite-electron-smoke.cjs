const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app } = require('electron')

async function main() {
  const sqlite = require('node:sqlite')
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-electron-sqlite-smoke-'))
  const dbPath = path.join(tempRoot, 'smoke.sqlite')

  try {
    await app.whenReady()
    const db = new sqlite.DatabaseSync(dbPath)
    try {
      db.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE smoke_check (
          id INTEGER PRIMARY KEY,
          value TEXT NOT NULL
        );
        INSERT INTO smoke_check (value) VALUES ('ok');
      `)
      const row = db.prepare('SELECT value FROM smoke_check WHERE id = ?').get(1)
      if (row?.value !== 'ok') {
        throw new Error('Electron SQLite smoke query returned an unexpected result')
      }
      console.log('Electron SQLite smoke passed')
    } finally {
      db.close()
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
    app.quit()
  }
}

main().catch((error) => {
  console.error(error)
  app.exit(1)
})
