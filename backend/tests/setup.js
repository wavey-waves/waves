import { beforeAll, afterAll, afterEach } from 'vitest'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import User from '../src/models/user.model.js'
import Room from '../src/models/room.model.js'
import Message from '../src/models/message.model.js'

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
  // Build model indexes up front and await them. Mongoose creates indexes
  // asynchronously, so without this the unique-constraint tests (userName,
  // roomName) can race the index build and see a duplicate insert succeed —
  // flaky locally, reliably failing on faster CI runners. afterEach only
  // clears documents, not indexes, so building once here is enough.
  await Promise.all([User.init(), Room.init(), Message.init()])
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
