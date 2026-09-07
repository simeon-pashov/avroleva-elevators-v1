// Prisma CLI config (Prisma 6.19+). The CLI does not read the monorepo-root .env on its own,
// so we load it here explicitly; apps/api/src/platform/config.ts does the same at runtime.
import path from 'node:path'
import { config as loadDotenv } from 'dotenv'
import { defineConfig } from 'prisma/config'

loadDotenv({ path: path.resolve(__dirname, '../../.env') })

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
})
