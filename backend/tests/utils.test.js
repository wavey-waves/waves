import { describe, it, expect } from 'vitest'
import jwt from 'jsonwebtoken'
import { generateToken } from '../src/libs/utils.js'

// Minimal res stub that records the cookie call.
function makeRes() {
  return {
    cookies: [],
    cookie(name, value, options) {
      this.cookies.push({ name, value, options })
    },
  }
}

describe('generateToken', () => {
  it('returns a JWT encoding the userId and verifiable with JWT_SECRET', () => {
    const res = makeRes()
    const token = generateToken('user-abc', res)
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    expect(decoded.userId).toBe('user-abc')
  })

  it('sets an httpOnly jwt cookie with a 7-day maxAge', () => {
    const res = makeRes()
    generateToken('user-xyz', res)
    expect(res.cookies).toHaveLength(1)
    const [{ name, options }] = res.cookies
    expect(name).toBe('jwt')
    expect(options.httpOnly).toBe(true)
    expect(options.maxAge).toBe(7 * 24 * 60 * 60 * 1000)
    expect(options.sameSite).toBe('lax')
  })

  it('does not set the secure flag outside production', () => {
    const res = makeRes()
    generateToken('u', res) // NODE_ENV=test in setup
    expect(res.cookies[0].options.secure).toBe(false)
  })
})
