import { execSync } from 'node:child_process'
import { PrismaClient } from '../src/generated/prisma/index.js'
import { config } from '../src/platform/config.js'
import { testDbUrl } from './helpers.js'

/** Ensures `avroleva_test` exists and is migrated before any test file runs (Goals D&C pattern). */
export default async function globalSetup(): Promise<void> {
  const url = new URL(testDbUrl())
  const dbName = url.pathname.slice(1)
  const admin = new PrismaClient({ datasourceUrl: config.DATABASE_URL })
  try {
    const rows = await admin.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM pg_database WHERE datname = '${dbName}'`,
    )
    if (rows.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`)
  } catch (err) {
    // Unit tests can still run; the integration suite will fail with this message.
    console.error(
      `\n[global-setup] Postgres not reachable at ${config.DATABASE_URL.replace(/:[^:@/]+@/, ':***@')} - integration tests will fail.\n${String(err).split('\n')[0]}\n`,
    )
    return
  } finally {
    await admin.$disconnect()
  }
  execSync('npx prisma migrate deploy', {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, DATABASE_URL: testDbUrl() },
    stdio: 'inherit',
  })
}
