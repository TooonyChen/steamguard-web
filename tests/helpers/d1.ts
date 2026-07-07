import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Bindings, D1Database, D1PreparedStatement, D1Result } from '../../src/types'

// Minimal D1 shim over node:sqlite for vitest's node environment. Implements
// exactly the D1Database surface declared in src/types.ts. batch() runs
// statements sequentially (not atomically), which is fine for tests.
export function createTestDb(): D1Database {
  const db = new DatabaseSync(':memory:')
  // D1 does not enforce foreign keys (the app relies on this, e.g. audit rows
  // survive viewer hard-deletes); node:sqlite enables them by default.
  db.exec('PRAGMA foreign_keys = OFF')
  const migrationsDir = join(process.cwd(), 'migrations')
  for (const file of readdirSync(migrationsDir).sort()) {
    if (file.endsWith('.sql')) db.exec(readFileSync(join(migrationsDir, file), 'utf8'))
  }

  const prepare = (query: string): D1PreparedStatement => {
    let params: SQLInputValue[] = []
    const statement: D1PreparedStatement = {
      bind(...values: unknown[]) {
        params = values as SQLInputValue[]
        return statement
      },
      async first<T>(columnName?: string) {
        const row = db.prepare(query).get(...params) as Record<string, unknown> | undefined
        if (row === undefined) return null
        return (columnName ? row[columnName] : row) as T
      },
      async all<T>(): Promise<D1Result<T>> {
        const results = db.prepare(query).all(...params) as T[]
        return { results, success: true, meta: {} }
      },
      async run(): Promise<D1Result> {
        const info = db.prepare(query).run(...params)
        return { success: true, meta: { changes: Number(info.changes) } }
      },
    }
    return statement
  }

  return {
    prepare,
    async batch(statements: D1PreparedStatement[]) {
      const out: D1Result[] = []
      for (const statement of statements) out.push(await statement.run())
      return out as never
    },
    async exec(query: string) {
      db.exec(query)
      return { success: true, meta: {} }
    },
  }
}

export function createTestEnv(overrides: Partial<Bindings> = {}): Bindings {
  return {
    DB: createTestDb(),
    APP_SECRET: 'test-app-secret',
    ENVIRONMENT: 'test',
    ...overrides,
  }
}
