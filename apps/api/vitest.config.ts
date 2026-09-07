import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Integration tests share one Postgres test database and truncate it - no parallel files.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
})
