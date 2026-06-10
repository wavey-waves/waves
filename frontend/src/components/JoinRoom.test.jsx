import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axios from 'axios'
import JoinRoom from './JoinRoom'

vi.mock('axios')
vi.mock('unique-names-generator', () => ({
  uniqueNamesGenerator: vi.fn(() => 'happy-blue-tiger'),
  adjectives: [],
  colors: [],
  animals: [],
}))

describe('JoinRoom', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  describe('rendering per room theme', () => {
    it('renders for the Global room', () => {
      render(<JoinRoom onJoin={vi.fn()} onClose={vi.fn()} roomName="Global" />)
      expect(
        screen.getByRole('heading', { name: /Join Global Room/i })
      ).toBeInTheDocument()
    })

    it('renders for the Network room', () => {
      render(<JoinRoom onJoin={vi.fn()} onClose={vi.fn()} roomName="Network" />)
      expect(
        screen.getByRole('heading', { name: /Join Network Room/i })
      ).toBeInTheDocument()
    })

    it('renders for a custom room', () => {
      render(
        <JoinRoom
          onJoin={vi.fn()}
          onClose={vi.fn()}
          roomName="Custom ABC123"
          isCustomRoom={true}
        />
      )
      expect(
        screen.getByRole('heading', { name: /Join Custom ABC123 Room/i })
      ).toBeInTheDocument()
    })
  })

  it('generates a random name on mount and persists it to localStorage', async () => {
    render(<JoinRoom onJoin={vi.fn()} onClose={vi.fn()} roomName="Global" />)
    await waitFor(() => {
      expect(screen.getByText('happy-blue-tiger')).toBeInTheDocument()
    })
    const stored = JSON.parse(localStorage.getItem('anonymousUser'))
    expect(stored.name).toBe('happy-blue-tiger')
    expect(typeof stored.color).toBe('string')
    expect(typeof stored.expiry).toBe('number')
  })

  it('reuses a valid non-expired anonymous user from localStorage', async () => {
    localStorage.setItem(
      'anonymousUser',
      JSON.stringify({
        name: 'stored-name',
        color: '#123456',
        expiry: Date.now() + 100000,
      })
    )
    render(<JoinRoom onJoin={vi.fn()} onClose={vi.fn()} roomName="Global" />)
    await waitFor(() => {
      expect(screen.getByText('stored-name')).toBeInTheDocument()
    })
  })

  it('regenerates a new name when the stored user is expired', async () => {
    localStorage.setItem(
      'anonymousUser',
      JSON.stringify({
        name: 'old-name',
        color: '#123456',
        expiry: Date.now() - 1000,
      })
    )
    render(<JoinRoom onJoin={vi.fn()} onClose={vi.fn()} roomName="Global" />)
    await waitFor(() => {
      expect(screen.getByText('happy-blue-tiger')).toBeInTheDocument()
    })
    expect(screen.queryByText('old-name')).not.toBeInTheDocument()
  })

  it('generates a new name when the "Generate New Name" button is clicked', async () => {
    const { uniqueNamesGenerator } = await import('unique-names-generator')
    uniqueNamesGenerator
      .mockReturnValueOnce('first-name')
      .mockReturnValueOnce('second-name')

    const user = userEvent.setup()
    render(<JoinRoom onJoin={vi.fn()} onClose={vi.fn()} roomName="Global" />)
    await waitFor(() => {
      expect(screen.getByText('first-name')).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /Generate New Name/i }))
    expect(screen.getByText('second-name')).toBeInTheDocument()
  })

  it('calls onClose when the close (X) button is clicked', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<JoinRoom onJoin={vi.fn()} onClose={onClose} roomName="Global" />)
    await user.click(screen.getByRole('button', { name: /Close/i }))
    expect(onClose).toHaveBeenCalled()
  })

  describe('anonymous join flow', () => {
    it('logs in directly when the anonymous user already exists', async () => {
      const onJoin = vi.fn()
      const user = userEvent.setup()
      axios.post.mockResolvedValueOnce({
        data: { _id: 'u1', userName: 'happy-blue-tiger', color: '#abcdef' },
      })

      render(<JoinRoom onJoin={onJoin} onClose={vi.fn()} roomName="Global" />)
      await waitFor(() => screen.getByText('happy-blue-tiger'))
      await user.click(
        screen.getByRole('button', { name: /Join Anonymously/i })
      )

      await waitFor(() => {
        expect(axios.post).toHaveBeenCalledWith('/api/auth/login', {
          userName: 'happy-blue-tiger',
        })
      })
      expect(onJoin).toHaveBeenCalledWith({
        id: 'u1',
        username: 'happy-blue-tiger',
        color: '#abcdef',
        isAnonymous: true,
      })
    })

    it('signs up a new anonymous user when login returns 400 Invalid credentials', async () => {
      const onJoin = vi.fn()
      const user = userEvent.setup()
      axios.post
        .mockRejectedValueOnce({
          response: { status: 400, data: { message: 'Invalid credentials' } },
        })
        .mockResolvedValueOnce({
          data: { _id: 'new1', userName: 'happy-blue-tiger', color: '#fff000' },
        })

      render(<JoinRoom onJoin={onJoin} onClose={vi.fn()} roomName="Global" />)
      await waitFor(() => screen.getByText('happy-blue-tiger'))
      await user.click(
        screen.getByRole('button', { name: /Join Anonymously/i })
      )

      await waitFor(() => {
        expect(axios.post).toHaveBeenCalledWith(
          '/api/auth/signup',
          expect.objectContaining({
            userName: 'happy-blue-tiger',
            isAnonymous: true,
          })
        )
      })
      expect(onJoin).toHaveBeenCalledWith({
        id: 'new1',
        username: 'happy-blue-tiger',
        color: '#fff000',
        isAnonymous: true,
      })
    })

    it('surfaces an error when anonymous signup fails', async () => {
      const user = userEvent.setup()
      axios.post
        .mockRejectedValueOnce({
          response: { status: 400, data: { message: 'Invalid credentials' } },
        })
        .mockRejectedValueOnce({
          response: { data: { message: 'Name taken' } },
        })

      render(<JoinRoom onJoin={vi.fn()} onClose={vi.fn()} roomName="Global" />)
      await waitFor(() => screen.getByText('happy-blue-tiger'))
      await user.click(
        screen.getByRole('button', { name: /Join Anonymously/i })
      )

      await waitFor(() => {
        expect(screen.getByText('Name taken')).toBeInTheDocument()
      })
    })

    it('surfaces an error when login fails with a non-400 error', async () => {
      const user = userEvent.setup()
      axios.post.mockRejectedValueOnce({
        response: { status: 500, data: { message: 'Server down' } },
      })

      render(<JoinRoom onJoin={vi.fn()} onClose={vi.fn()} roomName="Global" />)
      await waitFor(() => screen.getByText('happy-blue-tiger'))
      await user.click(
        screen.getByRole('button', { name: /Join Anonymously/i })
      )

      await waitFor(() => {
        expect(screen.getByText('Server down')).toBeInTheDocument()
      })
    })
  })

  describe('registered (custom account) flow', () => {
    const switchToCustom = async (user) => {
      await user.click(screen.getByRole('button', { name: /Custom Account/i }))
    }

    it('only accepts lowercased alphanumeric usernames', async () => {
      const user = userEvent.setup()
      render(<JoinRoom onJoin={vi.fn()} onClose={vi.fn()} roomName="Global" />)
      await switchToCustom(user)

      const input = screen.getByPlaceholderText(/Choose a username/i)
      await user.type(input, 'Foo_Bar!99')
      expect(input).toHaveValue('foobar99')
    })

    it('logs in an existing user (create-new unchecked)', async () => {
      const onJoin = vi.fn()
      const user = userEvent.setup()
      axios.post.mockResolvedValueOnce({
        data: { _id: 'reg1', userName: 'alice', color: '#111111' },
      })

      render(<JoinRoom onJoin={onJoin} onClose={vi.fn()} roomName="Global" />)
      await switchToCustom(user)
      await user.type(screen.getByPlaceholderText(/Choose a username/i), 'alice')
      await user.type(screen.getByPlaceholderText(/Enter password/i), 'secret12')
      await user.click(screen.getByRole('button', { name: /^Login$/i }))

      await waitFor(() => {
        expect(axios.post).toHaveBeenCalledWith('/api/auth/login', {
          userName: 'alice',
          password: 'secret12',
        })
      })
      expect(onJoin).toHaveBeenCalledWith({
        id: 'reg1',
        username: 'alice',
        color: '#111111',
        isAnonymous: false,
      })
    })

    it('signs up a new user when "Create new account" is checked', async () => {
      const onJoin = vi.fn()
      const user = userEvent.setup()
      axios.post.mockResolvedValueOnce({
        data: { _id: 'reg2', userName: 'bob', color: '#222222' },
      })

      render(<JoinRoom onJoin={onJoin} onClose={vi.fn()} roomName="Network" />)
      await switchToCustom(user)
      await user.type(screen.getByPlaceholderText(/Choose a username/i), 'bob')
      await user.type(screen.getByPlaceholderText(/Enter password/i), 'password1')
      await user.click(screen.getByLabelText(/Create new account/i))
      await user.click(screen.getByRole('button', { name: /Create Account/i }))

      await waitFor(() => {
        expect(axios.post).toHaveBeenCalledWith(
          '/api/auth/signup',
          expect.objectContaining({
            userName: 'bob',
            password: 'password1',
            isAnonymous: false,
          })
        )
      })
      expect(onJoin).toHaveBeenCalledWith({
        id: 'reg2',
        username: 'bob',
        color: '#222222',
        isAnonymous: false,
      })
    })

    it('surfaces server errors from a rejected login', async () => {
      const user = userEvent.setup()
      axios.post.mockRejectedValueOnce({
        response: { data: { message: 'Invalid credentials' } },
      })

      render(<JoinRoom onJoin={vi.fn()} onClose={vi.fn()} roomName="Global" />)
      await switchToCustom(user)
      await user.type(screen.getByPlaceholderText(/Choose a username/i), 'alice')
      await user.type(screen.getByPlaceholderText(/Enter password/i), 'wrongpass')
      await user.click(screen.getByRole('button', { name: /^Login$/i }))

      await waitFor(() => {
        expect(screen.getByText('Invalid credentials')).toBeInTheDocument()
      })
    })

    it('toggles password visibility', async () => {
      const user = userEvent.setup()
      render(<JoinRoom onJoin={vi.fn()} onClose={vi.fn()} roomName="Global" />)
      await switchToCustom(user)

      const pwInput = screen.getByPlaceholderText(/Enter password/i)
      expect(pwInput).toHaveAttribute('type', 'password')
      await user.click(screen.getByRole('button', { name: /Show password/i }))
      expect(pwInput).toHaveAttribute('type', 'text')
      await user.click(screen.getByRole('button', { name: /Hide password/i }))
      expect(pwInput).toHaveAttribute('type', 'password')
    })
  })
})
