import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    // Mongoose + a single in-memory Mongo instance are shared across files,
    // so run test files serially rather than in parallel worker threads.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/index.js'],
    },
  },
})
