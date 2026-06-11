import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the Tauri IPC boundary: invoke() and the Channel class.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class Channel {
    constructor() {
      this.onmessage = null
    }
  },
}))

import { invoke } from '@tauri-apps/api/core'
import { createTransport, dtoToUi, resolveMeshRoom, meshJoin, radio } from './tauri.js'

// A camelCase MessageDto as serialized by src-tauri/src/ipc.rs.
const textDto = {
  id: 'blake3-abc',
  originId: 'ed25519-peer',
  originSeq: 3,
  lamport: 12,
  createdAtMs: 1700000000000,
  room: 'mesh-global',
  authorName: 'wave-ab12',
  authorColor: '#8b5cf6',
  kind: 'text',
  text: 'hello mesh',
}

describe('dtoToUi', () => {
  it('maps a text MessageDto to the UI message shape', () => {
    expect(dtoToUi(textDto)).toEqual({
      _id: 'blake3-abc',
      text: 'hello mesh',
      senderId: {
        _id: 'ed25519-peer',
        userName: 'wave-ab12',
        color: '#8b5cf6',
      },
      roomName: 'mesh-global',
      createdAt: new Date(1700000000000).toISOString(),
      kind: 'text',
    })
  })

  it('converts createdAtMs to an ISO-8601 createdAt string', () => {
    const ui = dtoToUi({ ...textDto, createdAtMs: 0 })
    expect(ui.createdAt).toBe('1970-01-01T00:00:00.000Z')
  })

  it('carries blob metadata through for image messages', () => {
    const ui = dtoToUi({
      ...textDto,
      kind: 'image',
      text: undefined,
      blobHash: 'blob-hash',
      blobSize: 1234,
      blobMime: 'image/png',
      thumbB64: 'AAAA',
    })
    expect(ui.kind).toBe('image')
    expect(ui.text).toBe('')
    expect(ui.blob).toEqual({
      hash: 'blob-hash',
      size: 1234,
      mime: 'image/png',
      thumbB64: 'AAAA',
    })
  })
})

describe('resolveMeshRoom', () => {
  it('maps a custom code to mesh-<CODE> (uppercased)', () => {
    expect(resolveMeshRoom({ roomType: 'custom', roomCode: 'ab12cd' })).toEqual({
      roomName: 'mesh-AB12CD',
      code: 'ab12cd',
    })
  })

  it('maps global and network rooms to mesh-global', () => {
    expect(resolveMeshRoom({ roomType: 'global' }).roomName).toBe('mesh-global')
    expect(resolveMeshRoom({ roomType: 'network' }).roomName).toBe('mesh-global')
  })
})

describe('mesh transport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('send invokes mesh_send_text and returns the mapped message', async () => {
    invoke.mockResolvedValueOnce(textDto)
    const transport = createTransport({})

    const real = await transport.send({
      roomName: 'mesh-global',
      payload: { text: 'hello mesh' },
    })

    expect(invoke).toHaveBeenCalledWith('mesh_send_text', {
      room: 'mesh-global',
      text: 'hello mesh',
    })
    expect(real._id).toBe('blake3-abc')
    expect(real.senderId._id).toBe('ed25519-peer')
  })

  it('retries the "mesh-starting" rejection with a ~300ms backoff', async () => {
    vi.useFakeTimers()
    invoke
      .mockRejectedValueOnce('mesh-starting')
      .mockRejectedValueOnce('mesh-starting')
      .mockResolvedValueOnce(textDto)
    const transport = createTransport({})

    const promise = transport.send({
      roomName: 'mesh-global',
      payload: { text: 'hello mesh' },
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(invoke).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(300)
    expect(invoke).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(300)
    expect(invoke).toHaveBeenCalledTimes(3)

    const real = await promise
    expect(real._id).toBe('blake3-abc')
  })

  it('gives up after 20 attempts and surfaces the rejection', async () => {
    vi.useFakeTimers()
    invoke.mockRejectedValue('mesh-starting')
    const transport = createTransport({})

    const promise = transport.fetchHistory('mesh-global')
    const assertion = expect(promise).rejects.toBe('mesh-starting')
    await vi.runAllTimersAsync()
    await assertion
    expect(invoke).toHaveBeenCalledTimes(20)
  })

  it('does not retry rejections other than "mesh-starting"', async () => {
    invoke.mockRejectedValue('room name too long')
    const transport = createTransport({})

    await expect(
      transport.send({ roomName: 'mesh-global', payload: { text: 'x' } })
    ).rejects.toBe('room name too long')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('sendImage invokes mesh_send_image with raw bytes and room/mime headers', async () => {
    const imageDto = {
      ...textDto,
      kind: 'image',
      text: undefined,
      blobHash: 'blob-hash',
      blobSize: 4096,
      blobMime: 'image/png',
      thumbB64: 'AAAA',
    }
    invoke.mockResolvedValueOnce(imageDto)
    const transport = createTransport({})
    const bytes = new Uint8Array([1, 2, 3]).buffer

    const sent = await transport.sendImage({
      roomName: 'mesh-global',
      bytes,
      mime: 'image/png',
    })

    // Contract: bytes are the raw invoke body (never JSON), metadata rides
    // as request headers — see mesh_send_image in src-tauri/src/ipc.rs.
    expect(invoke).toHaveBeenCalledWith('mesh_send_image', bytes, {
      headers: { room: 'mesh-global', mime: 'image/png' },
    })
    expect(sent.kind).toBe('image')
    expect(sent._id).toBe('blake3-abc')
    expect(sent.blob).toEqual({
      hash: 'blob-hash',
      size: 4096,
      mime: 'image/png',
      thumbB64: 'AAAA',
    })
  })

  it('sendImage retries the "mesh-starting" rejection', async () => {
    vi.useFakeTimers()
    const imageDto = { ...textDto, kind: 'image', blobHash: 'h', blobSize: 1, blobMime: 'image/png', thumbB64: 'AA' }
    invoke.mockRejectedValueOnce('mesh-starting').mockResolvedValueOnce(imageDto)
    const transport = createTransport({})

    const promise = transport.sendImage({
      roomName: 'mesh-global',
      bytes: new Uint8Array([1]).buffer,
      mime: 'image/png',
    })
    await vi.runAllTimersAsync()

    expect((await promise)._id).toBe('blake3-abc')
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('exportBlob invokes mesh_export_blob and returns the exported path', async () => {
    invoke.mockResolvedValueOnce('/appdata/blobs/export/abc.png')
    const transport = createTransport({})

    await expect(
      transport.exportBlob({ hash: 'abc', mime: 'image/png' })
    ).resolves.toBe('/appdata/blobs/export/abc.png')
    expect(invoke).toHaveBeenCalledWith('mesh_export_blob', {
      hash: 'abc',
      mime: 'image/png',
    })
  })

  it('exportBlob surfaces "blob-not-ready" without retrying', async () => {
    invoke.mockRejectedValue('blob-not-ready')
    const transport = createTransport({})

    await expect(
      transport.exportBlob({ hash: 'abc', mime: 'image/png' })
    ).rejects.toBe('blob-not-ready')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('forwards blobReady/blobFailed events to the optional handlers', async () => {
    invoke.mockResolvedValue(undefined)
    const transport = createTransport({})
    const handlers = {
      onServerMessage: vi.fn(),
      onUserLeft: vi.fn(),
      onBlobReady: vi.fn(),
      onBlobFailed: vi.fn(),
    }

    await transport.connect({ roomName: 'mesh-global', handlers })
    const channel = invoke.mock.calls.find(([cmd]) => cmd === 'mesh_subscribe')[1].channel

    // Blob events are mesh-wide (content-addressed), not room-filtered.
    channel.onmessage({ type: 'blobReady', hash: 'hash-1' })
    expect(handlers.onBlobReady).toHaveBeenCalledWith('hash-1')

    channel.onmessage({ type: 'blobFailed', hash: 'hash-2', reason: 'exceeds-autofetch-cap' })
    expect(handlers.onBlobFailed).toHaveBeenCalledWith('hash-2', 'exceeds-autofetch-cap')
  })

  it('tolerates blob events when the optional handlers are not provided', async () => {
    invoke.mockResolvedValue(undefined)
    const transport = createTransport({})
    const handlers = { onServerMessage: vi.fn(), onUserLeft: vi.fn() }

    await transport.connect({ roomName: 'mesh-global', handlers })
    const channel = invoke.mock.calls.find(([cmd]) => cmd === 'mesh_subscribe')[1].channel

    expect(() => {
      channel.onmessage({ type: 'blobReady', hash: 'x' })
      channel.onmessage({ type: 'blobFailed', hash: 'x', reason: 'r' })
    }).not.toThrow()
  })

  it('fetchHistory maps every MessageDto in the result', async () => {
    invoke.mockResolvedValueOnce([textDto, { ...textDto, id: 'blake3-def' }])
    const transport = createTransport({})

    const history = await transport.fetchHistory('mesh-global')

    expect(invoke).toHaveBeenCalledWith('mesh_history', { room: 'mesh-global' })
    expect(history.map((m) => m._id)).toEqual(['blake3-abc', 'blake3-def'])
  })

  it('filters subscribe events to the connected room and stops after disconnect', async () => {
    invoke.mockResolvedValue(undefined)
    const transport = createTransport({})
    const handlers = {
      onServerMessage: vi.fn(),
      onPeerMessage: vi.fn(),
      onUserLeft: vi.fn(),
      onError: vi.fn(),
      onReconnected: vi.fn(),
    }

    await transport.connect({ roomName: 'mesh-global', handlers })

    const subscribeCall = invoke.mock.calls.find(([cmd]) => cmd === 'mesh_subscribe')
    expect(subscribeCall).toBeTruthy()
    const channel = subscribeCall[1].channel

    // A message for another room is dropped.
    channel.onmessage({ type: 'message', message: { ...textDto, room: 'mesh-AB12CD' } })
    expect(handlers.onServerMessage).not.toHaveBeenCalled()

    // A message for the connected room is mapped and delivered.
    channel.onmessage({ type: 'message', message: textDto })
    expect(handlers.onServerMessage).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'blake3-abc', roomName: 'mesh-global' })
    )

    // peerDown maps to onUserLeft.
    channel.onmessage({ type: 'peerDown', origin_id: 'ed25519-peer' })
    expect(handlers.onUserLeft).toHaveBeenCalledWith({ socketId: 'ed25519-peer' })

    // After disconnect, nothing is delivered anymore.
    transport.disconnect()
    channel.onmessage({ type: 'message', message: textDto })
    expect(handlers.onServerMessage).toHaveBeenCalledTimes(1)
  })
})

describe('radio API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps each call onto its radio_* command', async () => {
    invoke.mockResolvedValue(undefined)

    await radio.radioCaps()
    expect(invoke).toHaveBeenCalledWith('radio_caps')

    await radio.radioHost('ab12cd')
    expect(invoke).toHaveBeenCalledWith('radio_host', { code: 'ab12cd' })

    await radio.radioStopHost()
    expect(invoke).toHaveBeenCalledWith('radio_stop_host')

    await radio.radioJoin('ab12cd')
    expect(invoke).toHaveBeenCalledWith('radio_join', { code: 'ab12cd' })

    await radio.radioLeave()
    expect(invoke).toHaveBeenCalledWith('radio_leave')
  })

  it('returns the SSID resolved by radio_host', async () => {
    invoke.mockResolvedValueOnce('WAVES-AB12CD')
    await expect(radio.radioHost('AB12CD')).resolves.toBe('WAVES-AB12CD')
  })

  it('surfaces rejections verbatim — the radio is not retried, even on "mesh-starting"', async () => {
    // The radio is a separate subsystem from the mesh node: no withMeshRetry.
    invoke.mockRejectedValue('mesh-starting')
    await expect(radio.radioCaps()).rejects.toBe('mesh-starting')
    expect(invoke).toHaveBeenCalledTimes(1)

    invoke.mockRejectedValue('radio-requires-windows')
    await expect(radio.radioJoin('AB12CD')).rejects.toBe('radio-requires-windows')
  })
})

describe('meshJoin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers the author and returns the device endpoint id', async () => {
    invoke.mockImplementation((cmd) => {
      if (cmd === 'mesh_set_author') return Promise.resolve()
      if (cmd === 'mesh_info') {
        return Promise.resolve({ ready: true, endpointId: 'endpoint-1' })
      }
      return Promise.reject(new Error(`unexpected command ${cmd}`))
    })

    const result = await meshJoin({ name: 'wave-ab12', color: '#8b5cf6' })

    expect(invoke).toHaveBeenCalledWith('mesh_set_author', {
      name: 'wave-ab12',
      color: '#8b5cf6',
    })
    expect(result).toEqual({ endpointId: 'endpoint-1' })
  })
})
