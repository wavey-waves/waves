import { describe, it, expect } from 'vitest'
import mongoose from 'mongoose'
import User from '../src/models/user.model.js'
import Room from '../src/models/room.model.js'
import Message from '../src/models/message.model.js'

const DAY = 24 * 60 * 60 * 1000

describe('User model', () => {
  it('requires userName and color', async () => {
    await expect(User.create({})).rejects.toThrow()
  })

  it('enforces unique usernames', async () => {
    await User.create({ userName: 'uniq', color: '#fff' })
    await expect(User.create({ userName: 'uniq', color: '#fff' })).rejects.toThrow()
  })

  it('sets a ~7-day expiry for anonymous users', async () => {
    const u = await User.create({ userName: 'anon', color: '#fff', isAnonymous: true })
    const days = (u.expiresAt.getTime() - Date.now()) / DAY
    expect(days).toBeGreaterThan(6.9)
    expect(days).toBeLessThan(7.1)
  })

  it('sets a ~1-year expiry for registered users', async () => {
    const u = await User.create({ userName: 'reg', color: '#fff', isAnonymous: false })
    const days = (u.expiresAt.getTime() - Date.now()) / DAY
    expect(days).toBeGreaterThan(364)
  })
})

describe('Room model', () => {
  it('generateUniqueCode returns a 6-char uppercase code', async () => {
    const code = await Room.generateUniqueCode()
    expect(code).toMatch(/^[A-Z0-9]{6}$/)
  })

  it('stores the code uppercased', async () => {
    const room = await Room.create({ roomName: 'custom-abcdef', code: 'abcdef' })
    expect(room.code).toBe('ABCDEF')
  })

  it('enforces a unique roomName', async () => {
    await Room.create({ roomName: 'network-1.2.3' })
    await expect(Room.create({ roomName: 'network-1.2.3' })).rejects.toThrow()
  })

  it('defaults isCustomRoom to false and sets an expiry', async () => {
    const room = await Room.create({ roomName: 'network-9.9.9' })
    expect(room.isCustomRoom).toBe(false)
    expect(room.expiresAt).toBeInstanceOf(Date)
  })
})

describe('Message model', () => {
  it('requires a senderId', async () => {
    await expect(Message.create({ room: 'global', text: 'hi' })).rejects.toThrow()
  })

  it('defaults the room to global-room', async () => {
    const senderId = new mongoose.Types.ObjectId()
    const msg = await Message.create({ senderId, text: 'hi' })
    expect(msg.room).toBe('global-room')
  })

  it('rejects duplicate reactions from the same user', async () => {
    const senderId = new mongoose.Types.ObjectId()
    const userId = new mongoose.Types.ObjectId()
    await expect(
      Message.create({
        senderId,
        room: 'global',
        text: 'hi',
        reactions: [
          { userId, emoji: '👍' },
          { userId, emoji: '❤️' },
        ],
      }),
    ).rejects.toThrow(/one reaction per message/i)
  })

  it('allows distinct users to react', async () => {
    const senderId = new mongoose.Types.ObjectId()
    const msg = await Message.create({
      senderId,
      room: 'global',
      text: 'hi',
      reactions: [
        { userId: new mongoose.Types.ObjectId(), emoji: '👍' },
        { userId: new mongoose.Types.ObjectId(), emoji: '👍' },
      ],
    })
    expect(msg.reactions).toHaveLength(2)
  })
})
