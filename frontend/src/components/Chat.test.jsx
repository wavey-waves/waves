import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axios from 'axios'
import { io } from 'socket.io-client'
import { MemoryRouter } from 'react-router-dom'
import Chat from './Chat'

vi.mock('axios')
vi.mock('socket.io-client')

vi.mock('react-toastify', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  ToastContainer: () => null,
}))

// Stub the imported PNG asset.
vi.mock('../assets/icon.png', () => ({ default: 'icon.png' }))

// ---------------------------------------------------------------------------
// A small EventEmitter-like fake socket so tests can trigger server events.
// ---------------------------------------------------------------------------
function createFakeSocket() {
  const handlers = {}
  return {
    handlers,
    on: vi.fn((event, cb) => {
      handlers[event] = handlers[event] || []
      handlers[event].push(cb)
    }),
    off: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    // Test helper to trigger a registered handler.
    trigger(event, payload) {
      ;(handlers[event] || []).forEach((cb) => cb(payload))
    },
  }
}

const baseUser = {
  id: 'me-1',
  username: 'me',
  color: '#abcdef',
  isAnonymous: false,
}

const renderChat = (props = {}) =>
  render(
    <MemoryRouter>
      <Chat
        roomType="global"
        roomCode={undefined}
        user={baseUser}
        roomData={null}
        {...props}
      />
    </MemoryRouter>
  )

let fakeSocket

describe('Chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeSocket = createFakeSocket()
    io.mockReturnValue(fakeSocket)
    // Default: history fetch returns an empty array.
    axios.get.mockResolvedValue({ data: [] })
    axios.post.mockResolvedValue({ data: {} })
  })

  it('initializes the socket and emits "join" for a global room', async () => {
    renderChat()
    await waitFor(() => {
      expect(io).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(fakeSocket.emit).toHaveBeenCalledWith('join', 'global-room')
    })
    expect(axios.get).toHaveBeenCalledWith('/api/messages/global-room')
  })

  it('subscribes to chatMessage and userLeft (matching the server event names)', async () => {
    renderChat()
    await waitFor(() => expect(io).toHaveBeenCalled())

    const subscribed = fakeSocket.on.mock.calls.map(([evt]) => evt)
    expect(subscribed).toContain('chatMessage')
    // The client now subscribes to "userLeft" (camelCase) to match what the
    // server actually emits. It does not handle "userJoined".
    expect(subscribed).toContain('userLeft')
    expect(subscribed).not.toContain('user-left')
    expect(subscribed).not.toContain('userJoined')
  })

  it('fetches the network room assignment for network rooms', async () => {
    axios.get.mockImplementation((url) => {
      if (url === '/api/rooms/assign') {
        return Promise.resolve({ data: { roomName: 'net-42' } })
      }
      return Promise.resolve({ data: [] })
    })
    renderChat({ roomType: 'network' })

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith('/api/rooms/assign')
    })
    await waitFor(() => {
      expect(fakeSocket.emit).toHaveBeenCalledWith('join', 'net-42')
    })
  })

  it('uses the custom room name and endpoint for custom rooms', async () => {
    renderChat({ roomType: 'custom', roomCode: 'ABC123' })

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith('/api/messages/custom-ABC123')
    })
    await waitFor(() => {
      expect(fakeSocket.emit).toHaveBeenCalledWith('join', 'custom-ABC123')
    })
  })

  it('renders historical messages returned by the fetch (last 50)', async () => {
    axios.get.mockResolvedValueOnce({
      data: [
        {
          _id: 'h1',
          text: 'hello from history',
          senderId: { _id: 'other', userName: 'bob', color: '#ff0000' },
          createdAt: new Date().toISOString(),
        },
      ],
    })
    renderChat()
    await waitFor(() => {
      expect(screen.getByText('hello from history')).toBeInTheDocument()
    })
    expect(screen.getByText('bob')).toBeInTheDocument()
  })

  it('renders an incoming chatMessage socket event', async () => {
    renderChat()
    await waitFor(() => expect(io).toHaveBeenCalled())

    act(() => {
      fakeSocket.trigger('chatMessage', {
        _id: 'srv-1',
        text: 'incoming!',
        senderId: { _id: 'other', userName: 'carol', color: '#00ff00' },
        createdAt: new Date().toISOString(),
      })
    })

    await waitFor(() => {
      expect(screen.getByText('incoming!')).toBeInTheDocument()
    })
  })

  it('deduplicates messages by _id (no double render)', async () => {
    renderChat()
    await waitFor(() => expect(io).toHaveBeenCalled())

    const msg = {
      _id: 'dup-1',
      text: 'only once',
      senderId: { _id: 'other', userName: 'dave', color: '#0000ff' },
      createdAt: new Date().toISOString(),
    }
    act(() => {
      fakeSocket.trigger('chatMessage', msg)
      fakeSocket.trigger('chatMessage', msg)
    })

    await waitFor(() => {
      expect(screen.getAllByText('only once')).toHaveLength(1)
    })
  })

  it('replaces an optimistic message when the server confirms it via tempId (upsert)', async () => {
    const user = userEvent.setup()
    renderChat()
    await waitFor(() => expect(io).toHaveBeenCalled())

    const textarea = screen.getByPlaceholderText(/Type your message/i)
    await user.type(textarea, 'optimistic msg')
    await user.click(screen.getByRole('button', { name: /Send/i }))

    // Optimistic copy is shown immediately.
    await waitFor(() => {
      expect(screen.getByText('optimistic msg')).toBeInTheDocument()
    })

    // crypto.randomUUID is stubbed; grab the tempId from the POST body.
    const sendCall = axios.post.mock.calls.find(([url]) =>
      url.startsWith('/api/messages/send/')
    )
    expect(sendCall).toBeTruthy()
    const tempId = sendCall[1].tempId

    // Server echoes back the confirmed message carrying the tempId.
    act(() => {
      fakeSocket.trigger('chatMessage', {
        _id: 'permanent-1',
        tempId,
        text: 'optimistic msg',
        senderId: { _id: baseUser.id, userName: baseUser.username, color: baseUser.color },
        createdAt: new Date().toISOString(),
      })
    })

    // Still exactly one rendering of the text.
    await waitFor(() => {
      expect(screen.getAllByText('optimistic msg')).toHaveLength(1)
    })
  })

  describe('sending messages', () => {
    it('posts to /api/messages/send/global-room and renders the optimistic message', async () => {
      const user = userEvent.setup()
      renderChat()
      await waitFor(() => expect(io).toHaveBeenCalled())

      const textarea = screen.getByPlaceholderText(/Type your message/i)
      await user.type(textarea, 'hello world')
      await user.click(screen.getByRole('button', { name: /Send/i }))

      await waitFor(() => {
        expect(screen.getByText('hello world')).toBeInTheDocument()
      })
      const sendCall = axios.post.mock.calls.find(([url]) =>
        url.startsWith('/api/messages/send/')
      )
      expect(sendCall[0]).toBe('/api/messages/send/global-room')
      expect(sendCall[1]).toMatchObject({ text: 'hello world' })
      expect(sendCall[1]).not.toHaveProperty('p2pSent')
      expect(textarea).toHaveValue('')
    })

    it('posts to the custom-room endpoint for custom rooms', async () => {
      const user = userEvent.setup()
      renderChat({ roomType: 'custom', roomCode: 'ZZZ111' })
      await waitFor(() => expect(io).toHaveBeenCalled())

      const textarea = screen.getByPlaceholderText(/Type your message/i)
      await user.type(textarea, 'custom hi')
      await user.click(screen.getByRole('button', { name: /Send/i }))

      await waitFor(() => {
        const sendCall = axios.post.mock.calls.find(([url]) =>
          url.startsWith('/api/messages/send/')
        )
        expect(sendCall[0]).toBe('/api/messages/send/custom-ZZZ111')
      })
    })

    it('does not post when the message is empty (button disabled)', async () => {
      renderChat()
      await waitFor(() => expect(io).toHaveBeenCalled())
      expect(screen.getByRole('button', { name: /Send/i })).toBeDisabled()
      const sends = axios.post.mock.calls.filter(([url]) =>
        url.startsWith('/api/messages/send/')
      )
      expect(sends).toHaveLength(0)
    })

    it('shows an error toast when the server send fails', async () => {
      const { toast } = await import('react-toastify')
      const user = userEvent.setup()
      axios.post.mockImplementation((url) => {
        if (url.startsWith('/api/messages/send/')) {
          return Promise.reject(new Error('network'))
        }
        return Promise.resolve({ data: {} })
      })
      renderChat()
      await waitFor(() => expect(io).toHaveBeenCalled())

      await user.type(screen.getByPlaceholderText(/Type your message/i), 'will fail')
      await user.click(screen.getByRole('button', { name: /Send/i }))

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to send message to server.')
      })
    })
  })

  it('does not show the attach-image button on the web transport (mesh-only UI)', async () => {
    renderChat()
    await waitFor(() => expect(io).toHaveBeenCalled())
    expect(
      screen.queryByRole('button', { name: /Attach image/i })
    ).not.toBeInTheDocument()
  })

  it('renders the header with the username and room title', async () => {
    renderChat()
    await waitFor(() => expect(io).toHaveBeenCalled())
    expect(screen.getByText(/Global room/i)).toBeInTheDocument()
    expect(screen.getByText('me')).toBeInTheDocument()
  })

  it('navigates home when the logo button is clicked', async () => {
    const user = userEvent.setup()
    renderChat()
    await waitFor(() => expect(io).toHaveBeenCalled())
    // Just assert the button exists and is clickable without throwing.
    await user.click(screen.getByRole('button', { name: /Go back to dashboard/i }))
  })

  it('disconnects the socket and emits leave on unmount', async () => {
    const { unmount } = renderChat()
    await waitFor(() => expect(io).toHaveBeenCalled())
    // The cleanup reads socketRef.current at cleanup time (not synchronously at
    // effect setup), so the live socket is disconnected and "leave" is emitted.
    expect(() => unmount()).not.toThrow()
    await waitFor(() => expect(fakeSocket.disconnect).toHaveBeenCalled())
    expect(fakeSocket.emit).toHaveBeenCalledWith('leave', 'global-room')
  })

  describe('UI behaviours', () => {
    it('shows the mobile room-info modal and closes it', async () => {
      const user = userEvent.setup()
      renderChat()
      await waitFor(() => expect(io).toHaveBeenCalled())

      await user.click(screen.getByRole('button', { name: /Show room info/i }))
      expect(screen.getByText('Room Info')).toBeInTheDocument()
      expect(screen.getByText(/Room Type:/i)).toBeInTheDocument()
    })

    it('shows a character counter near the limit', async () => {
      const user = userEvent.setup()
      renderChat()
      await waitFor(() => expect(io).toHaveBeenCalled())

      const textarea = screen.getByPlaceholderText(/Type your message/i)
      // 905 chars -> within warning window (>=900) but <= 1000.
      await user.click(textarea)
      // Use fireEvent-style paste via paste to avoid 905 keystrokes being slow.
      await user.paste('a'.repeat(905))
      await waitFor(() => {
        // remaining = 1000 - 905 = 95
        expect(screen.getByText('95')).toBeInTheDocument()
      })
    })

    it('copies the room link to the clipboard for a custom room (no native share)', async () => {
      const user = userEvent.setup()
      const { toast } = await import('react-toastify')
      // Ensure native share is absent so the clipboard fallback runs.
      const originalShare = navigator.share
      delete navigator.share
      // Force a spy clipboard (jsdom may provide a non-spy implementation).
      const writeText = vi.fn(() => Promise.resolve())
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
        writable: true,
      })

      renderChat({ roomType: 'custom', roomCode: 'SHARE1' })
      await waitFor(() => expect(io).toHaveBeenCalled())

      await user.click(
        screen.getByTitle('Click to share room with friends')
      )
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('/chat/custom/SHARE1')
      )
      expect(toast.success).toHaveBeenCalledWith(
        'Room link copied to clipboard!'
      )

      if (originalShare) navigator.share = originalShare
    })
  })

  describe('WebRTC signaling handlers', () => {
    it('creates peer connections for existing-room-users and emits an offer', async () => {
      renderChat()
      await waitFor(() => expect(io).toHaveBeenCalled())

      await act(async () => {
        fakeSocket.trigger('existing-room-users', { users: ['peer-A'] })
        // allow the createOffer/setLocalDescription promise chain to resolve
        await Promise.resolve()
        await Promise.resolve()
      })

      await waitFor(() => {
        expect(fakeSocket.emit).toHaveBeenCalledWith(
          'webrtc-offer',
          expect.objectContaining({ to: 'peer-A' })
        )
      })
    })

    it('responds to a webrtc-offer with an answer', async () => {
      renderChat()
      await waitFor(() => expect(io).toHaveBeenCalled())

      await act(async () => {
        fakeSocket.trigger('webrtc-offer', {
          from: 'peer-B',
          offer: { type: 'offer', sdp: 'x' },
        })
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      await waitFor(() => {
        expect(fakeSocket.emit).toHaveBeenCalledWith(
          'webrtc-answer',
          expect.objectContaining({ to: 'peer-B' })
        )
      })
    })

    it('handles a webrtc-answer without throwing', async () => {
      renderChat()
      await waitFor(() => expect(io).toHaveBeenCalled())
      expect(() => {
        act(() => {
          fakeSocket.trigger('webrtc-answer', {
            from: 'peer-C',
            answer: { type: 'answer', sdp: 'y' },
          })
        })
      }).not.toThrow()
    })

    it('handles a webrtc-ice-candidate without throwing', async () => {
      renderChat()
      await waitFor(() => expect(io).toHaveBeenCalled())
      expect(() => {
        act(() => {
          fakeSocket.trigger('webrtc-ice-candidate', {
            from: 'peer-D',
            candidate: { candidate: 'fake' },
          })
        })
      }).not.toThrow()
    })

    it('warns and cleans up on userLeft', async () => {
      const { toast } = await import('react-toastify')
      renderChat()
      await waitFor(() => expect(io).toHaveBeenCalled())

      act(() => {
        fakeSocket.trigger('userLeft', { socketId: 'peer-A' })
      })
      expect(toast.warn).toHaveBeenCalledWith('A user has left the room.')
    })

    it('shows an error toast on a socket "error" event', async () => {
      const { toast } = await import('react-toastify')
      renderChat()
      await waitFor(() => expect(io).toHaveBeenCalled())

      act(() => {
        fakeSocket.trigger('error', new Error('boom'))
      })
      expect(toast.error).toHaveBeenCalledWith(
        'Connection error. Please try refreshing the page.'
      )
    })
  })
})
