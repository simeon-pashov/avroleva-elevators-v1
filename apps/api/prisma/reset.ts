import { execSync } from 'node:child_process'
import { PrismaClient } from '../src/generated/prisma/index.js'
import { config } from '../src/platform/config.js'

/**
 * `npm run db:reset` - drops every schema of the DATABASE_URL database (public + pgboss),
 * re-applies the migrations and runs the seed. Non-interactive; refuses anything that is not a
 * localhost database so it can never touch a VPS. (`prisma migrate reset` is interactive-only.)
 */
async function main() {
  const url = new URL(config.DATABASE_URL)
  if (!['localhost', '127.0.0.1', '::1', 'db'].includes(url.hostname)) {
    throw new Error(`db:reset refuses a non-local database host: ${url.hostname}`)
  }
  if (config.NODE_ENV === 'production') throw new Error('db:reset refuses NODE_ENV=production')
  const db = new PrismaClient({ datasourceUrl: config.DATABASE_URL })
  try {
    await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS pgboss CASCADE')
    await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE')
    await db.$executeRawUnsafe('CREATE SCHEMA public')
  } finally {
    await db.$disconnect()
  }
  console.log(`[db:reset] schemas dropped on ${url.hostname}${url.pathname}; applying migrations`)
  execSync('npx prisma migrate deploy', { stdio: 'inherit' })
  execSync('npx tsx prisma/seed.ts', { stdio: 'inherit' })
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
