import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axios from 'axios'
import App from './App'

vi.mock('axios')

// Mock the heavy Chat component: we only want to verify routing reaches it,
// not its socket/WebRTC internals (those are covered in Chat.test.jsx).
vi.mock('./components/Chat', () => ({
  default: ({ roomType, roomCode, user }) => (
    <div data-testid="chat">
      chat:{roomType}:{roomCode || 'none'}:{user?.username}
    </div>
  ),
}))

vi.mock('react-toastify', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warn: vi.fn() },
  ToastContainer: () => null,
}))

vi.mock('unique-names-generator', () => ({
  uniqueNamesGenerator: vi.fn(() => 'happy-blue-tiger'),
  adjectives: [],
  colors: [],
  animals: [],
}))

const setPath = (path) => {
  window.history.pushState({}, '', path)
}

describe('App routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    setPath('/')
  })

  it('renders the landing page at "/" with the Waves title and three room cards', () => {
    render(<App />)
    expect(screen.getByText('Waves')).toBeInTheDocument()
    expect(screen.getByText(/Join Global room/i)).toBeInTheDocument()
    expect(screen.getByText(/Join Network/i)).toBeInTheDocument()
    expect(screen.getByText(/Custom Room/i)).toBeInTheDocument()
  })

  it('opens the JoinRoom modal when a room card is clicked', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByText(/Join Global room/i))
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /Join Global Room/i })
      ).toBeInTheDocument()
    })
  })

  it('opens the CustomRoom modal when the Custom Room card is clicked', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByText(/Custom Room/i))
    await waitFor(() => {
      expect(
        screen.getByText(/Create a new room or join an existing one/i)
      ).toBeInTheDocument()
    })
  })

  it('opens the Documentation modal from the Docs button', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /Open Documentation/i }))
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /How Waves Works/i })
      ).toBeInTheDocument()
    })
  })

  describe('/chat/:roomType', () => {
    it('renders Chat when the session check succeeds (authenticated)', async () => {
      axios.get.mockResolvedValueOnce({
        data: {
          _id: 'u1',
          userName: 'alice',
          color: '#fff',
          isAnonymous: false,
        },
      })
      setPath('/chat/global')
      render(<App />)

      await waitFor(() => {
        expect(screen.getByTestId('chat')).toHaveTextContent(
          'chat:global:none:alice'
        )
      })
      expect(axios.get).toHaveBeenCalledWith('/api/auth/check')
    })

    it('shows the JoinRoom screen for a global room when not authenticated', async () => {
      axios.get.mockRejectedValueOnce({ response: { status: 401 } })
      setPath('/chat/global')
      render(<App />)

      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: /Join Global Room/i })
        ).toBeInTheDocument()
      })
    })

    it('redirects unknown room types to home', async () => {
      axios.get.mockRejectedValueOnce({ response: { status: 401 } })
      setPath('/chat/bogus')
      render(<App />)

      await waitFor(() => {
        expect(screen.getByText('Waves')).toBeInTheDocument()
      })
      expect(window.location.pathname).toBe('/')
    })
  })

  describe('/chat/custom/:roomCode', () => {
    it('verifies the room then shows JoinRoom when unauthenticated and room exists', async () => {
      axios.get.mockRejectedValueOnce({ response: { status: 401 } })
      axios.post.mockResolvedValueOnce({
        data: {
          roomId: 'r1',
          roomName: 'custom-ABC123',
          code: 'ABC123',
          memberCount: 2,
        },
      })
      setPath('/chat/custom/ABC123')
      render(<App />)

      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: /Join Custom ABC123 Room/i })
        ).toBeInTheDocument()
      })
      expect(axios.post).toHaveBeenCalledWith('/api/rooms/join', {
        code: 'ABC123',
      })
    })

    it('redirects to home when the custom room returns 404', async () => {
      axios.get.mockRejectedValueOnce({ response: { status: 401 } })
      axios.post.mockRejectedValueOnce({
        response: { status: 404 },
        message: 'not found',
      })
      setPath('/chat/custom/GONE99')
      render(<App />)

      await waitFor(() => {
        expect(screen.getByText('Waves')).toBeInTheDocument()
      })
      expect(window.location.pathname).toBe('/')
    })
  })
})
