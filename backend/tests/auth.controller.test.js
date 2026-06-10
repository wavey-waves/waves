import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import User from '../src/models/user.model.js'
import { authedUser } from './helpers/index.js'

const cookieFrom = (res) => res.headers['set-cookie']?.[0] ?? ''

describe('POST /api/auth/signup', () => {
  it('rejects a missing username', async () => {
    const res = await request(app).post('/api/auth/signup').send({ color: '#fff' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/username is required/i)
  })

  it('rejects a blank username', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ userName: '   ', color: '#fff' })
    expect(res.status).toBe(400)
  })

  it('rejects a missing color', async () => {
    const res = await request(app).post('/api/auth/signup').send({ userName: 'alice' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/color is required/i)
  })

  it('creates an anonymous user, sets a jwt cookie, and returns public fields', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ userName: 'anon1', color: '#8b5cf6', isAnonymous: true })

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ userName: 'anon1', color: '#8b5cf6', isAnonymous: true })
    expect(res.body).not.toHaveProperty('password')
    expect(cookieFrom(res)).toMatch(/^jwt=/)

    const inDb = await User.findOne({ userName: 'anon1' })
    expect(inDb).not.toBeNull()
    expect(inDb.password).toBeUndefined()
  })

  it('trims the username before saving', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ userName: '  spacey  ', color: '#fff', isAnonymous: true })
    expect(res.status).toBe(201)
    expect(res.body.userName).toBe('spacey')
  })

  it('rejects a duplicate username', async () => {
    await request(app)
      .post('/api/auth/signup')
      .send({ userName: 'dupe', color: '#fff', isAnonymous: true })
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ userName: 'dupe', color: '#fff', isAnonymous: true })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/already exists/i)
  })

  it('requires a password of at least 6 chars for registered users', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ userName: 'reg1', color: '#fff', isAnonymous: false, password: '123' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/6 characters/i)
  })

  it('creates a registered user and hashes the password', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ userName: 'reg2', color: '#fff', isAnonymous: false, password: 'sup3rsecret' })
    expect(res.status).toBe(201)
    const inDb = await User.findOne({ userName: 'reg2' })
    expect(inDb.password).toBeDefined()
    expect(inDb.password).not.toBe('sup3rsecret')
  })
})

describe('POST /api/auth/login', () => {
  it('rejects a missing username', async () => {
    const res = await request(app).post('/api/auth/login').send({})
    expect(res.status).toBe(400)
  })

  it('rejects an unknown user', async () => {
    const res = await request(app).post('/api/auth/login').send({ userName: 'ghost' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/invalid credentials/i)
  })

  it('logs in an anonymous user without checking a password', async () => {
    await request(app)
      .post('/api/auth/signup')
      .send({ userName: 'anonlogin', color: '#fff', isAnonymous: true })
    const res = await request(app).post('/api/auth/login').send({ userName: 'anonlogin' })
    expect(res.status).toBe(200)
    expect(res.body.userName).toBe('anonlogin')
    expect(cookieFrom(res)).toMatch(/^jwt=/)
  })

  it('logs in a registered user with the correct password', async () => {
    await request(app)
      .post('/api/auth/signup')
      .send({ userName: 'reglogin', color: '#fff', isAnonymous: false, password: 'password123' })
    const res = await request(app)
      .post('/api/auth/login')
      .send({ userName: 'reglogin', password: 'password123' })
    expect(res.status).toBe(200)
    // login returns `_id` (consistent with signup / checkAuth), not `id`
    expect(res.body._id).toBeDefined()
    expect(res.body).not.toHaveProperty('id')
  })

  it('rejects a registered user with a wrong password', async () => {
    await request(app)
      .post('/api/auth/signup')
      .send({ userName: 'regwrong', color: '#fff', isAnonymous: false, password: 'password123' })
    const res = await request(app)
      .post('/api/auth/login')
      .send({ userName: 'regwrong', password: 'nope' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/invalid credentials/i)
  })
})

describe('POST /api/auth/logout', () => {
  it('clears the jwt cookie', async () => {
    const res = await request(app).post('/api/auth/logout')
    expect(res.status).toBe(200)
    expect(cookieFrom(res)).toMatch(/jwt=;/)
  })
})

describe('GET /api/auth/check', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/auth/check')
    expect(res.status).toBe(401)
  })

  it('returns the authenticated user with a valid token', async () => {
    const { user, cookie } = await authedUser({ userName: 'checker', color: '#0f0' })
    const res = await request(app).get('/api/auth/check').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.userName).toBe('checker')
    expect(res.body._id).toBe(user._id.toString())
    expect(res.body.isAuthenticated).toBe(true)
  })
})
