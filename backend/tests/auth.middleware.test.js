import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import app from '../src/app.js'
import { authedUser } from './helpers/index.js'

// protectedRoute is exercised through GET /api/auth/check.

describe('protectedRoute middleware', () => {
  it('rejects requests with no token (401)', async () => {
    const res = await request(app).get('/api/auth/check')
    expect(res.status).toBe(401)
    expect(res.body.isAuthenticated).toBe(false)
  })

  it('rejects a malformed/invalid token (401)', async () => {
    const res = await request(app).get('/api/auth/check').set('Cookie', 'jwt=not-a-real-token')
    expect(res.status).toBe(401)
    expect(res.body.isAuthenticated).toBe(false)
  })

  it('rejects a token signed with the wrong secret (401)', async () => {
    const bad = jwt.sign({ userId: new mongoose.Types.ObjectId().toString() }, 'wrong-secret')
    const res = await request(app).get('/api/auth/check').set('Cookie', `jwt=${bad}`)
    expect(res.status).toBe(401)
  })

  it('returns 404 when the token references a non-existent user', async () => {
    const token = jwt.sign(
      { userId: new mongoose.Types.ObjectId().toString() },
      process.env.JWT_SECRET,
    )
    const res = await request(app).get('/api/auth/check').set('Cookie', `jwt=${token}`)
    expect(res.status).toBe(404)
  })

  it('passes through and attaches req.user for a valid token', async () => {
    const { user, cookie } = await authedUser({ userName: 'mw-user' })
    const res = await request(app).get('/api/auth/check').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body._id).toBe(user._id.toString())
  })
})
