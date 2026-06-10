import '@testing-library/jest-dom/vitest'
import { vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Unmount React trees and clear the DOM between tests.
afterEach(() => {
  cleanup()
})

// ---------------------------------------------------------------------------
// Global / browser API stubs that jsdom does not implement.
// These keep Chat.jsx (WebRTC + scrolling + clipboard) from throwing.
// ---------------------------------------------------------------------------

// scrollIntoView / scrollTo are not implemented in jsdom.
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn()
}
window.scrollTo = vi.fn()

// crypto.randomUUID is used to build optimistic message payloads.
if (!globalThis.crypto) {
  globalThis.crypto = {}
}
let uuidCounter = 0
if (!globalThis.crypto.randomUUID) {
  globalThis.crypto.randomUUID = () => `test-uuid-${++uuidCounter}`
}

// ---------------------------------------------------------------------------
// WebRTC stubs. jsdom has none of these. We provide light fakes so that the
// signaling code paths (offer/answer/ICE) can run without crashing. The fakes
// resolve promises so the .then() chains complete.
// ---------------------------------------------------------------------------
class FakeDataChannel {
  constructor(label) {
    this.label = label
    this.readyState = 'connecting'
    this.onmessage = null
    this.onopen = null
    this.send = vi.fn()
    this.close = vi.fn()
  }
}

class FakeRTCPeerConnection {
  constructor() {
    this.connectionState = 'new'
    this.localDescription = { type: 'offer', sdp: 'fake-sdp' }
    this.onicecandidate = null
    this.onconnectionstatechange = null
    this.ondatachannel = null
    this.createDataChannel = vi.fn((label) => new FakeDataChannel(label))
    this.createOffer = vi.fn(() => Promise.resolve({ type: 'offer', sdp: 'fake-offer' }))
    this.createAnswer = vi.fn(() => Promise.resolve({ type: 'answer', sdp: 'fake-answer' }))
    this.setLocalDescription = vi.fn(() => Promise.resolve())
    this.setRemoteDescription = vi.fn(() => Promise.resolve())
    this.addIceCandidate = vi.fn(() => Promise.resolve())
    this.close = vi.fn()
  }
}

globalThis.RTCPeerConnection = FakeRTCPeerConnection
window.RTCPeerConnection = FakeRTCPeerConnection
globalThis.RTCSessionDescription = class RTCSessionDescription {
  constructor(init) {
    Object.assign(this, init)
  }
}
globalThis.RTCIceCandidate = class RTCIceCandidate {
  constructor(init) {
    Object.assign(this, init)
  }
}

// ---------------------------------------------------------------------------
// navigator.clipboard / navigator.share
// ---------------------------------------------------------------------------
if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(() => Promise.resolve()) },
    configurable: true,
    writable: true,
  })
}
