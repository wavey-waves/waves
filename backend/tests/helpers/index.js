import jwt from 'jsonwebtoken'
import User from '../../src/models/user.model.js'

let counter = 0

/**
 * Create a user document directly (bypassing the signup HTTP flow).
 * Defaults to an anonymous user; pass overrides for registered users.
 */
export async function createUser(overrides = {}) {
  counter += 1
  return User.create({
    userName: overrides.userName ?? `user_${counter}`,
    color: overrides.color ?? '#8b5cf6',
    isAnonymous: overrides.isAnonymous ?? true,
    ...overrides,
  })
}

/** Build the `jwt=<token>` Cookie header value for a given user id. */
export function authCookie(userId) {
  const token = jwt.sign({ userId: userId.toString() }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  })
  return `jwt=${token}`
}

/** Create a user and return both the doc and a ready-to-send auth cookie. */
export async function authedUser(overrides = {}) {
  const user = await createUser(overrides)
  return { user, cookie: authCookie(user._id) }
}
