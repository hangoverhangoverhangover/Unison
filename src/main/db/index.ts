import Database from 'better-sqlite3'
import { MIGRATIONS } from './schema'

export type Db = Database.Database

/** Open (or create) the library database and bring it up to the latest schema. */
export function openDb(file: string): Db {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

export function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current > MIGRATIONS.length) {
    throw new Error(
      `Library database is schema v${current}, newer than this app (v${MIGRATIONS.length}).`
    )
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    const sql = MIGRATIONS[v]!
    db.transaction(() => {
      db.exec(sql)
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}
