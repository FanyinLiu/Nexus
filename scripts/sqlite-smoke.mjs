#!/usr/bin/env node

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-sqlite-smoke-'))
const dbPath = path.join(tempRoot, 'smoke.sqlite')

try {
  const db = new DatabaseSync(dbPath)
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
      throw new Error('SQLite smoke query returned an unexpected result')
    }
  } finally {
    db.close()
  }

  console.log('SQLite smoke passed')
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true })
}
