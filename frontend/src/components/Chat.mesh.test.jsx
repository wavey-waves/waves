import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Chat from './Chat'

// Mesh-mode Chat tests (docs/MESH.md P2.b): the transport seam is mocked at
// the module boundary, so these cover Chat's image UI — attach button, thumb
// rendering, blobReady/blobFailed state — without any Tauri runtime.

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

// Chat lazily imports convertFileSrc to turn exported blob paths into asset
// URLs; mock it to a recognizable scheme.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class Channel {},
  convertFileSrc: vi.fn((path) => `asset://localhost${path}`),
}))

let fakeTransport
let capturedHandlers

vi.mock('../transport', () => ({
  createTransport: vi.fn(async () => fakeTransport),
}))

const baseUser = {
  id: 'me-1',
  username: 'me',
  color: '#abcdef',
  isAnonymous: false,
}

const HASH = 'a'.repeat(64)

const imageMessage = (overrides = {}) => ({
  _id: 'img-1',
  text: '',
  kind: 'image',
  blob: { hash: HASH, size: 1234, mime: 'image/png', thumbB64: 'QUJD' },
  senderId: { _id: 'other-1', userName: 'bob', color: '#ff0000' },
  roomName: 'mesh-global',
  createdAt: new Date().toISOString(),
  ...overrides,
})

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

const connectChat = async (props) => {
  renderChat(props)
  await waitFor(() => expect(fakeTransport.connect).toHaveBeenCalled())
}

describe('Chat (mesh transport)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedHandlers = null
    fakeTransport = {
      kind: 'mesh',
      resolveRoom: vi.fn(async () => ({ roomName: 'mesh-global' })),
      fetchHistory: vi.fn(async () => []),
      connect: vi.fn(async ({ handlers }) => {
        capturedHandlers = handlers
      }),
      send: vi.fn(),
      sendImage: vi.fn(),
      // Default: blob still downloading (the arrival probe stays pending).
      exportBlob: vi.fn(() => Promise.reject('blob-not-ready')),
      disconnect: vi.fn(),
    }
  })

  it('shows the attach-image button only once the mesh transport is up', async () => {
    await connectChat()
    expect(screen.getByRole('button', { name: /Attach image/i })).toBeInTheDocument()
  })

  describe('image rendering', () => {
    it('renders the inline base64 thumbnail immediately for an image message', async () => {
      await connectChat()

      await act(async () => {
        capturedHandlers.onServerMessage(imageMessage())
      })

      const img = await screen.findByAltText('Shared image')
      expect(img).toHaveAttribute('src', 'data:image/jpeg;base64,QUJD')
      // Pending hint: the wrapper pulses until the blob resolves either way.
      expect(img.parentElement.className).toContain('animate-pulse')
    })

    it('swaps to the exported asset URL when blobReady fires', async () => {
      fakeTransport.exportBlob
        .mockRejectedValueOnce('blob-not-ready') // arrival probe
        .mockResolvedValueOnce(`/appdata/blobs/export/${HASH}.png`)
      await connectChat()

      await act(async () => {
        capturedHandlers.onServerMessage(imageMessage())
      })
      await screen.findByAltText('Shared image')

      await act(async () => {
        capturedHandlers.onBlobReady(HASH)
      })

      await waitFor(() => {
        expect(screen.getByAltText('Shared image')).toHaveAttribute(
          'src',
          `asset://localhost/appdata/blobs/export/${HASH}.png`
        )
      })
      expect(fakeTransport.exportBlob).toHaveBeenLastCalledWith({
        hash: HASH,
        mime: 'image/png',
      })
      // Pending hint is gone once the full-res image is in.
      const img = screen.getByAltText('Shared image')
      expect(img.parentElement.className).not.toContain('animate-pulse')
    })

    it('keeps the thumbnail and labels a blobFailed cap rejection', async () => {
      await connectChat()

      await act(async () => {
        capturedHandlers.onServerMessage(imageMessage())
      })
      await screen.findByAltText('Shared image')

      await act(async () => {
        capturedHandlers.onBlobFailed(HASH, 'exceeds-autofetch-cap')
      })

      expect(
        await screen.findByText(/full image unavailable:/i)
      ).toHaveTextContent('too large for auto-download')
      // Thumbnail stays as the rendered image.
      expect(screen.getByAltText('Shared image')).toHaveAttribute(
        'src',
        'data:image/jpeg;base64,QUJD'
      )
    })

    it('shows the raw reason for other blobFailed causes', async () => {
      await connectChat()

      await act(async () => {
        capturedHandlers.onServerMessage(imageMessage())
        capturedHandlers.onBlobFailed(HASH, 'no-provider-reachable')
      })

      expect(
        await screen.findByText(/full image unavailable:/i)
      ).toHaveTextContent('no-provider-reachable')
    })

    it('renders an image message from history with its thumbnail', async () => {
      fakeTransport.fetchHistory.mockResolvedValue([imageMessage({ _id: 'hist-1' })])
      await connectChat()

      const img = await screen.findByAltText('Shared image')
      expect(img).toHaveAttribute('src', 'data:image/jpeg;base64,QUJD')
    })
  })

  describe('sending images', () => {
    it('sends the picked file through transport.sendImage and renders the result', async () => {
      const sent = imageMessage({
        _id: 'sent-1',
        senderId: { _id: baseUser.id, userName: baseUser.username, color: baseUser.color },
      })
      fakeTransport.sendImage.mockResolvedValue(sent)
      // The sender holds the blob, so the immediate export succeeds.
      fakeTransport.exportBlob.mockResolvedValue(`/appdata/blobs/export/${HASH}.png`)
      await connectChat()

      const file = new File([new Uint8Array([1, 2, 3])], 'pic.png', { type: 'image/png' })
      await act(async () => {
        fireEvent.change(screen.getByLabelText('Image file'), {
          target: { files: [file] },
        })
      })

      await waitFor(() => {
        expect(fakeTransport.sendImage).toHaveBeenCalledWith(
          expect.objectContaining({ roomName: 'mesh-global', mime: 'image/png' })
        )
      })
      expect(fakeTransport.sendImage.mock.calls[0][0].bytes).toBeInstanceOf(ArrayBuffer)

      // Own image flips to the full-res asset URL right away.
      await waitFor(() => {
        expect(screen.getByAltText('Shared image')).toHaveAttribute(
          'src',
          `asset://localhost/appdata/blobs/export/${HASH}.png`
        )
      })
    })

    it('rejects files over 25 MB with a toast and never calls the transport', async () => {
      const { toast } = await import('react-toastify')
      await connectChat()

      const bigFile = {
        name: 'huge.png',
        type: 'image/png',
        size: 26 * 1024 * 1024,
        arrayBuffer: vi.fn(),
      }
      await act(async () => {
        fireEvent.change(screen.getByLabelText('Image file'), {
          target: { files: [bigFile] },
        })
      })

      expect(toast.error).toHaveBeenCalledWith('Image is too large (max 25 MB).')
      expect(fakeTransport.sendImage).not.toHaveBeenCalled()
      expect(bigFile.arrayBuffer).not.toHaveBeenCalled()
    })

    it('disables the attach button while a send is in flight', async () => {
      let resolveSend
      fakeTransport.sendImage.mockImplementation(
        () => new Promise((resolve) => { resolveSend = resolve })
      )
      await connectChat()

      const file = new File([new Uint8Array([1])], 'pic.png', { type: 'image/png' })
      await act(async () => {
        fireEvent.change(screen.getByLabelText('Image file'), {
          target: { files: [file] },
        })
      })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Attach image/i })).toBeDisabled()
      })

      await act(async () => {
        resolveSend(imageMessage({ _id: 'sent-2' }))
      })
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Attach image/i })).not.toBeDisabled()
      })
    })

    it('toasts when the image send fails', async () => {
      const { toast } = await import('react-toastify')
      fakeTransport.sendImage.mockRejectedValue(new Error('boom'))
      await connectChat()

      const file = new File([new Uint8Array([1])], 'pic.png', { type: 'image/png' })
      await act(async () => {
        fireEvent.change(screen.getByLabelText('Image file'), {
          target: { files: [file] },
        })
      })

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to send image.')
      })
      // The button is usable again after the failure.
      expect(screen.getByRole('button', { name: /Attach image/i })).not.toBeDisabled()
    })
  })
})
