import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { io as Client } from 'socket.io-client'
import { server } from '../src/libs/socket.js'

let url

beforeAll(async () => {
  await new Promise((resolve) => {
    server.listen(0, () => {
      const { port } = server.address()
      url = `http://localhost:${port}`
      resolve()
    })
  })
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

function connect() {
  const socket = Client(url, { transports: ['websocket'], forceNew: true })
  return new Promise((resolve) => socket.on('connect', () => resolve(socket)))
}

function once(socket, event, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeout)
    socket.once(event, (payload) => {
      clearTimeout(timer)
      resolve(payload)
    })
  })
}

// Assert an event does NOT arrive within `window` ms.
function never(socket, event, window = 400) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, window)
    socket.once(event, () => {
      clearTimeout(timer)
      reject(new Error(`unexpectedly received ${event}`))
    })
  })
}

describe('socket.io room + signaling handlers', () => {
  it('sends existing-room-users to a joiner and notifies the room', async () => {
    const a = await connect()
    a.emit('join', 'room-x')
    const firstJoin = await once(a, 'existing-room-users')
    expect(firstJoin.users).toEqual([])

    const b = await connect()
    const joinedNotice = once(a, 'userJoined')
    b.emit('join', 'room-x')
    const existingForB = await once(b, 'existing-room-users')
    expect(existingForB.users).toContain(a.id)
    const notice = await joinedNotice
    expect(notice.socketId).toBe(b.id)

    a.disconnect()
    b.disconnect()
  })

  it('relays a webrtc-offer between peers sharing a room', async () => {
    const a = await connect()
    const b = await connect()
    a.emit('join', 'rtc-room')
    b.emit('join', 'rtc-room')
    await once(b, 'existing-room-users')

    const offerOnB = once(b, 'webrtc-offer')
    a.emit('webrtc-offer', { offer: { sdp: 'fake' }, to: b.id })
    const received = await offerOnB
    expect(received.from).toBe(a.id)
    expect(received.offer.sdp).toBe('fake')

    a.disconnect()
    b.disconnect()
  })

  it('does NOT relay signaling between peers that share no room', async () => {
    const a = await connect()
    const b = await connect()
    a.emit('join', 'room-a')
    b.emit('join', 'room-b')
    await once(a, 'existing-room-users')
    await once(b, 'existing-room-users')

    const guard = never(b, 'webrtc-offer')
    a.emit('webrtc-offer', { offer: { sdp: 'x' }, to: b.id })
    await expect(guard).resolves.toBeUndefined()

    a.disconnect()
    b.disconnect()
  })

  it('emits userLeft when a peer leaves the room', async () => {
    const a = await connect()
    const b = await connect()
    a.emit('join', 'leave-room')
    b.emit('join', 'leave-room')
    await once(b, 'existing-room-users')

    const leftNotice = once(a, 'userLeft')
    b.emit('leave', 'leave-room')
    const notice = await leftNotice
    expect(notice.socketId).toBe(b.id)

    a.disconnect()
    b.disconnect()
  })
})
