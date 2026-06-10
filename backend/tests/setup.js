import { beforeAll, afterAll, afterEach } from 'vitest'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'

// A single in-memory MongoDB instance backs the whole backend test suite.
// `fileParallelism: false` (vitest.config.js) keeps files serial so they can
// share one connection without clobbering each other.

let mongo

// Tests rely on a deterministic JWT secret rather than a real .env.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
process.env.NODE_ENV = 'test'

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  await mongoose.connect(mongo.getUri())
})

afterEach(async () => {
  // Wipe every collection between tests for isolation.
  const { collections } = mongoose.connection
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({})
  }
})

afterAll(async () => {
  await mongoose.disconnect()
  if (mongo) await mongo.stop()
})
