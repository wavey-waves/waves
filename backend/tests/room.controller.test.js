import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import Room from '../src/models/room.model.js'
import { authedUser } from './helpers/index.js'

describe('GET /api/rooms/assign', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/rooms/assign')
    expect(res.status).toBe(401)
  })

  it('creates a network room keyed by the /24 subnet', async () => {
    const { user, cookie } = await authedUser()
    const res = await request(app)
      .get('/api/rooms/assign')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '203.0.113.42')

    expect(res.status).toBe(200)
    expect(res.body.roomName).toBe('network-203.0.113')
    expect(res.body.memberCount).toBe(1)
    expect(res.body.members[0]._id).toBe(user._id.toString())
  })

  it('reuses an existing network room and does not double-add a member', async () => {
    const { cookie } = await authedUser()
    await request(app)
      .get('/api/rooms/assign')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '203.0.113.42')
    const res = await request(app)
      .get('/api/rooms/assign')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '203.0.113.99') // same /24 subnet

    expect(res.status).toBe(200)
    expect(res.body.memberCount).toBe(1)
    const rooms = await Room.find({ roomName: 'network-203.0.113' })
    expect(rooms).toHaveLength(1)
  })

  it('adds a second distinct user to the same subnet room', async () => {
    const a = await authedUser()
    const b = await authedUser()
    await request(app).get('/api/rooms/assign').set('Cookie', a.cookie).set('X-Forwarded-For', '10.0.0.1')
    const res = await request(app).get('/api/rooms/assign').set('Cookie', b.cookie).set('X-Forwarded-For', '10.0.0.2')
    expect(res.body.memberCount).toBe(2)
  })
})

describe('POST /api/rooms/create', () => {
  it('creates a custom room with a 6-char code (no auth required)', async () => {
    const res = await request(app).post('/api/rooms/create')
    expect(res.status).toBe(200)
    expect(res.body.code).toMatch(/^[A-Z0-9]{6}$/)
    expect(res.body.roomName).toBe(`custom-${res.body.code}`)
    expect(res.body.memberCount).toBe(0)
    expect(res.body.members).toEqual([])

    const inDb = await Room.findOne({ code: res.body.code })
    expect(inDb.isCustomRoom).toBe(true)
  })

  it('creates unique codes across calls', async () => {
    const a = await request(app).post('/api/rooms/create')
    const b = await request(app).post('/api/rooms/create')
    expect(a.body.code).not.toBe(b.body.code)
  })
})

describe('POST /api/rooms/join', () => {
  it('rejects a missing code', async () => {
    const res = await request(app).post('/api/rooms/join').send({})
    expect(res.status).toBe(400)
  })

  it('returns 404 for an unknown code', async () => {
    const res = await request(app).post('/api/rooms/join').send({ code: 'ZZZZZZ' })
    expect(res.status).toBe(404)
  })

  it('returns room info for a valid code (case-insensitive) without exposing members', async () => {
    const created = await request(app).post('/api/rooms/create')
    const res = await request(app)
      .post('/api/rooms/join')
      .send({ code: created.body.code.toLowerCase() })
    expect(res.status).toBe(200)
    expect(res.body.code).toBe(created.body.code)
    expect(res.body.members).toEqual([])
  })
})

describe('POST /api/rooms/leave/:roomName', () => {
  it('requires authentication', async () => {
    const res = await request(app).post('/api/rooms/leave/network-1.2.3')
    expect(res.status).toBe(401)
  })

  it('returns 404 for an unknown room', async () => {
    const { cookie } = await authedUser()
    const res = await request(app).post('/api/rooms/leave/nope').set('Cookie', cookie)
    expect(res.status).toBe(404)
  })

  it('removes the user from the room members', async () => {
    const { user, cookie } = await authedUser()
    await Room.create({ roomName: 'network-5.5.5', members: [user._id] })
    const res = await request(app).post('/api/rooms/leave/network-5.5.5').set('Cookie', cookie)
    expect(res.status).toBe(200)
    const room = await Room.findOne({ roomName: 'network-5.5.5' })
    expect(room.members).toHaveLength(0)
  })
})
