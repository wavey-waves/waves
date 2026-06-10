import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axios from 'axios'
import { toast } from 'react-toastify'
import CustomRoom from './CustomRoom'

vi.mock('axios')
vi.mock('react-toastify', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  ToastContainer: () => null,
}))

describe('CustomRoom', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the initial create/join choice screen', () => {
    render(<CustomRoom onJoin={() => {}} onClose={() => {}} />)
    expect(screen.getByText('Custom Room')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Create New Room/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Join Existing Room/i })
    ).toBeInTheDocument()
  })

  it('calls onClose when the close (X) button is clicked', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<CustomRoom onJoin={() => {}} onClose={onClose} />)
    // The close X button has no accessible name; it is the only button until a mode is chosen
    // beyond the two choice buttons. Grab it by its svg-bearing button.
    const buttons = screen.getAllByRole('button')
    // First button in DOM is the close button.
    await user.click(buttons[0])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  describe('create mode', () => {
    it('posts to /api/rooms/create and surfaces the returned code', async () => {
      const onJoin = vi.fn()
      const user = userEvent.setup()
      axios.post.mockResolvedValueOnce({
        data: {
          roomId: 'r1',
          roomName: 'custom-ABC123',
          code: 'ABC123',
          memberCount: 1,
        },
      })

      render(<CustomRoom onJoin={onJoin} onClose={() => {}} />)
      await user.click(screen.getByRole('button', { name: /Create New Room/i }))
      await user.click(screen.getByRole('button', { name: /^Create Room$/i }))

      await waitFor(() => {
        expect(axios.post).toHaveBeenCalledWith('/api/rooms/create')
      })
      expect(onJoin).toHaveBeenCalledWith({
        roomId: 'r1',
        roomName: 'custom-ABC123',
        code: 'ABC123',
        memberCount: 1,
      })
      expect(toast.success).toHaveBeenCalledWith('Room created! Code: ABC123')
    })

    it('shows an error toast when room creation fails', async () => {
      const user = userEvent.setup()
      axios.post.mockRejectedValueOnce({
        response: { data: { message: 'Server exploded' } },
      })

      render(<CustomRoom onJoin={vi.fn()} onClose={() => {}} />)
      await user.click(screen.getByRole('button', { name: /Create New Room/i }))
      await user.click(screen.getByRole('button', { name: /^Create Room$/i }))

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Server exploded')
      })
    })

    it('can return to the choice screen with Back', async () => {
      const user = userEvent.setup()
      render(<CustomRoom onJoin={vi.fn()} onClose={() => {}} />)
      await user.click(screen.getByRole('button', { name: /Create New Room/i }))
      await user.click(screen.getByRole('button', { name: /^Back$/i }))
      expect(
        screen.getByRole('button', { name: /Join Existing Room/i })
      ).toBeInTheDocument()
    })
  })

  describe('join mode', () => {
    it('uppercases input and disables the submit until 6 chars are entered', async () => {
      const user = userEvent.setup()
      render(<CustomRoom onJoin={vi.fn()} onClose={() => {}} />)
      await user.click(screen.getByRole('button', { name: /Join Existing Room/i }))

      const input = screen.getByPlaceholderText(/Enter 6-character code/i)
      const submit = screen.getByRole('button', { name: /^Join Room$/i })
      expect(submit).toBeDisabled()

      await user.type(input, 'abc12')
      expect(input).toHaveValue('ABC12')
      expect(submit).toBeDisabled()

      await user.type(input, '3')
      expect(input).toHaveValue('ABC123')
      expect(submit).toBeEnabled()
    })

    it('posts to /api/rooms/join with the trimmed code and surfaces success', async () => {
      const onJoin = vi.fn()
      const user = userEvent.setup()
      axios.post.mockResolvedValueOnce({
        data: {
          roomId: 'r9',
          roomName: 'custom-ZZZ999',
          code: 'ZZZ999',
          memberCount: 3,
        },
      })

      render(<CustomRoom onJoin={onJoin} onClose={() => {}} />)
      await user.click(screen.getByRole('button', { name: /Join Existing Room/i }))
      await user.type(
        screen.getByPlaceholderText(/Enter 6-character code/i),
        'zzz999'
      )
      await user.click(screen.getByRole('button', { name: /^Join Room$/i }))

      await waitFor(() => {
        expect(axios.post).toHaveBeenCalledWith('/api/rooms/join', {
          code: 'ZZZ999',
        })
      })
      expect(onJoin).toHaveBeenCalledWith({
        roomId: 'r9',
        roomName: 'custom-ZZZ999',
        code: 'ZZZ999',
        memberCount: 3,
      })
      expect(toast.success).toHaveBeenCalledWith('Joined room: ZZZ999')
    })

    it('shows an error toast on a 404 (room not found)', async () => {
      const user = userEvent.setup()
      axios.post.mockRejectedValueOnce({
        response: { status: 404, data: { message: 'Room not found' } },
      })

      render(<CustomRoom onJoin={vi.fn()} onClose={() => {}} />)
      await user.click(screen.getByRole('button', { name: /Join Existing Room/i }))
      await user.type(
        screen.getByPlaceholderText(/Enter 6-character code/i),
        'NOPE12'
      )
      await user.click(screen.getByRole('button', { name: /^Join Room$/i }))

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Room not found')
      })
    })

    it('warns instead of posting when the code is empty', async () => {
      const user = userEvent.setup()
      render(<CustomRoom onJoin={vi.fn()} onClose={() => {}} />)
      await user.click(screen.getByRole('button', { name: /Join Existing Room/i }))

      // Submitting with an empty code: the button is disabled, so submit the form
      // directly via Enter on the input after typing then clearing is awkward;
      // instead assert the guard by submitting the form programmatically.
      const input = screen.getByPlaceholderText(/Enter 6-character code/i)
      // Type a space-only string is blocked by maxLength/uppercase, so the guard
      // (!roomCode.trim()) is exercised when the form submits with empty value.
      const form = input.closest('form')
      form.requestSubmit
        ? form.requestSubmit()
        : form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Please enter a room code')
      })
      expect(axios.post).not.toHaveBeenCalled()
    })
  })
})
