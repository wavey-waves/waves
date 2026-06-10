import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import Message from '../src/models/message.model.js'
import { authedUser } from './helpers/index.js'

const ROOM = 'global'

describe('GET /api/messages/:roomName', () => {
  it('requires authentication', async () => {
    const res = await request(app).get(`/api/messages/${ROOM}`)
    expect(res.status).toBe(401)
  })

  it('returns an empty array for a room with no messages', async () => {
    const { cookie } = await authedUser()
    const res = await request(app).get(`/api/messages/${ROOM}`).set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns messages sorted oldest-first with the sender populated', async () => {
    const { user, cookie } = await authedUser({ userName: 'sender', color: '#abc' })
    await Message.create({ senderId: user._id, room: ROOM, text: 'first' })
    await Message.create({ senderId: user._id, room: ROOM, text: 'second' })

    const res = await request(app).get(`/api/messages/${ROOM}`).set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.map((m) => m.text)).toEqual(['first', 'second'])
    expect(res.body[0].senderId.userName).toBe('sender')
  })

  it('does not return messages from other rooms', async () => {
    const { user, cookie } = await authedUser()
    await Message.create({ senderId: user._id, room: 'other', text: 'elsewhere' })
    const res = await request(app).get(`/api/messages/${ROOM}`).set('Cookie', cookie)
    expect(res.body).toEqual([])
  })
})

describe('POST /api/messages/send/:roomName', () => {
  it('rejects empty text', async () => {
    const { cookie } = await authedUser()
    const res = await request(app)
      .post(`/api/messages/send/${ROOM}`)
      .set('Cookie', cookie)
      .send({ text: '   ' })
    expect(res.status).toBe(400)
  })

  it('persists a message and returns the populated doc', async () => {
    const { user, cookie } = await authedUser({ userName: 'poster' })
    const res = await request(app)
      .post(`/api/messages/send/${ROOM}`)
      .set('Cookie', cookie)
      .send({ text: '  hello world  ', tempId: 'temp-123' })

    expect(res.status).toBe(201)
    expect(res.body.text).toBe('hello world') // trimmed
    expect(res.body.senderId.userName).toBe('poster')

    const inDb = await Message.find({ room: ROOM })
    expect(inDb).toHaveLength(1)
    expect(inDb[0].senderId.toString()).toBe(user._id.toString())
  })
})

describe('POST /api/messages/:id/react', () => {
  it('rejects a missing emoji', async () => {
    const { user, cookie } = await authedUser()
    const msg = await Message.create({ senderId: user._id, room: ROOM, text: 'hi' })
    const res = await request(app)
      .post(`/api/messages/${msg._id}/react`)
      .set('Cookie', cookie)
      .send({})
    expect(res.status).toBe(400)
  })

  it('returns 404 for an unknown message', async () => {
    const { cookie } = await authedUser()
    const res = await request(app)
      .post('/api/messages/64b7f0000000000000000000/react')
      .set('Cookie', cookie)
      .send({ emoji: '👍' })
    expect(res.status).toBe(404)
  })

  it('adds a reaction', async () => {
    const { user, cookie } = await authedUser()
    const msg = await Message.create({ senderId: user._id, room: ROOM, text: 'hi' })
    const res = await request(app)
      .post(`/api/messages/${msg._id}/react`)
      .set('Cookie', cookie)
      .send({ emoji: '👍' })
    expect(res.status).toBe(200)
    expect(res.body.reactions).toHaveLength(1)
    expect(res.body.reactions[0].emoji).toBe('👍')
  })

  it('toggles the same emoji off when reacted twice', async () => {
    const { user, cookie } = await authedUser()
    const msg = await Message.create({ senderId: user._id, room: ROOM, text: 'hi' })
    await request(app).post(`/api/messages/${msg._id}/react`).set('Cookie', cookie).send({ emoji: '👍' })
    const res = await request(app).post(`/api/messages/${msg._id}/react`).set('Cookie', cookie).send({ emoji: '👍' })
    expect(res.body.reactions).toHaveLength(0)
  })

  it('replaces a previous reaction (one per user)', async () => {
    const { user, cookie } = await authedUser()
    const msg = await Message.create({ senderId: user._id, room: ROOM, text: 'hi' })
    await request(app).post(`/api/messages/${msg._id}/react`).set('Cookie', cookie).send({ emoji: '👍' })
    const res = await request(app).post(`/api/messages/${msg._id}/react`).set('Cookie', cookie).send({ emoji: '❤️' })
    expect(res.body.reactions).toHaveLength(1)
    expect(res.body.reactions[0].emoji).toBe('❤️')
  })
})

describe('DELETE /api/messages/cleanup', () => {
  it('keeps a room under the cap untouched', async () => {
    const { user, cookie } = await authedUser()
    await Message.create({ senderId: user._id, room: ROOM, text: 'keep me' })
    const res = await request(app).delete('/api/messages/cleanup').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(await Message.countDocuments({ room: ROOM })).toBe(1)
  })

  it('trims a room down to the newest 1000 messages', async () => {
    const { user, cookie } = await authedUser()
    const docs = Array.from({ length: 1005 }, (_, i) => ({
      senderId: user._id,
      room: ROOM,
      text: `m${i}`,
      // stagger createdAt so "newest 1000" is deterministic
      createdAt: new Date(Date.now() + i * 1000),
    }))
    // timestamps:false so our staggered createdAt values are preserved
    await Message.insertMany(docs, { timestamps: false })

    const res = await request(app).delete('/api/messages/cleanup').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(await Message.countDocuments({ room: ROOM })).toBe(1000)
    // the very first (oldest) message should have been pruned
    expect(await Message.findOne({ text: 'm0' })).toBeNull()
    expect(await Message.findOne({ text: 'm1004' })).not.toBeNull()
  })
})
