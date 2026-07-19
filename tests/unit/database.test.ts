import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { asNumber, inTransaction, openDatabase } from '@/shared/database.js'

const databasePath = join('work', 'database-test', 'nested', 'test.db')

describe('database helpers', () => {
  afterEach(() => rmSync(join('work', 'database-test'), { recursive: true, force: true }))

  it('creates parent directories for file-backed databases', () => {
    const database = openDatabase(databasePath)
    database.close()
    expect(existsSync(databasePath)).toBe(true)
  })

  it('rolls back a transaction when the operation fails', () => {
    const database = openDatabase(':memory:')
    database.exec('CREATE TABLE values_table(value INTEGER)')
    expect(() => inTransaction(database, () => {
      database.prepare('INSERT INTO values_table(value) VALUES (?)').run(1)
      throw new Error('stop')
    })).toThrow('stop')
    expect(database.prepare('SELECT COUNT(*) AS count FROM values_table').get()).toMatchObject({ count: 0 })
    database.close()
  })

  it('normalizes SQLite number representations', () => {
    expect(asNumber(4)).toBe(4)
    expect(asNumber(5n)).toBe(5)
    expect(asNumber(undefined)).toBe(0)
  })
})
