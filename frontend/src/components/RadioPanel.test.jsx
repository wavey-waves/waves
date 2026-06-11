import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'react-toastify'
import RadioPanel from './RadioPanel'

// Forest-mode radio panel tests (docs/MESH.md P3.b): the transport radio API
// is mocked at the module boundary — no Tauri runtime involved.

vi.mock('react-toastify', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  ToastContainer: () => null,
}))

const radio = vi.hoisted(() => ({
  radioCaps: vi.fn(),
  radioHost: vi.fn(),
  radioStopHost: vi.fn(),
  radioJoin: vi.fn(),
  radioLeave: vi.fn(),
}))

vi.mock('../transport/tauri.js', () => ({ radio }))

const colors = {
  accent: 'from-rose-300 via-pink-400 to-fuchsia-300',
  border: 'border-rose-500/20',
  button: 'from-rose-600 to-pink-600',
}

const supportedCaps = {
  supported: true,
  wifiDirectGo: true,
  wifiDirectClient: true,
  goStaConcurrency: true,
}

const renderPanel = () =>
  render(<RadioPanel roomCode="AB12CD" colors={colors} />)

// Expand the collapsible panel and wait for the caps probe to settle.
const openPanel = async (user) => {
  const result = renderPanel()
  await user.click(screen.getByRole('button', { name: /Forest radio/i }))
  await waitFor(() =>
    expect(screen.queryByText(/checking radio/i)).not.toBeInTheDocument()
  )
  return result
}

describe('RadioPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    radio.radioCaps.mockResolvedValue({ ...supportedCaps })
    radio.radioHost.mockResolvedValue('WAVES-AB12CD')
    radio.radioStopHost.mockResolvedValue(undefined)
    radio.radioJoin.mockResolvedValue(undefined)
    radio.radioLeave.mockResolvedValue(undefined)
  })

  it('probes radio_caps once on mount', async () => {
    renderPanel()
    await waitFor(() => expect(radio.radioCaps).toHaveBeenCalledTimes(1))
  })

  it('collapses to a single muted line when the radio is unsupported', async () => {
    radio.radioCaps.mockResolvedValue({ ...supportedCaps, supported: false })
    renderPanel()

    expect(
      await screen.findByText('WiFi-Direct radio requires Windows')
    ).toBeInTheDocument()
    // The whole panel is that line: no toggle, no action buttons.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('treats a failed caps probe like an unsupported radio', async () => {
    radio.radioCaps.mockRejectedValue('boom')
    renderPanel()

    expect(
      await screen.findByText('WiFi-Direct radio requires Windows')
    ).toBeInTheDocument()
  })

  describe('hosting', () => {
    it('hosts the room code and shows the SSID with a Stop button', async () => {
      const user = userEvent.setup()
      await openPanel(user)

      await user.click(screen.getByRole('button', { name: /^Host network$/i }))

      expect(radio.radioHost).toHaveBeenCalledWith('AB12CD')
      expect(await screen.findByText('hosting WAVES-AB12CD')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /Stop hosting/i })
      ).toBeInTheDocument()
      // The Host/Extend buttons are replaced by the hosting status row.
      expect(
        screen.queryByRole('button', { name: /^Host network$/i })
      ).not.toBeInTheDocument()
    })

    it('returns to the idle controls after Stop hosting', async () => {
      const user = userEvent.setup()
      await openPanel(user)
      await user.click(screen.getByRole('button', { name: /^Host network$/i }))
      await screen.findByText('hosting WAVES-AB12CD')

      await user.click(screen.getByRole('button', { name: /Stop hosting/i }))

      expect(radio.radioStopHost).toHaveBeenCalledTimes(1)
      expect(
        await screen.findByRole('button', { name: /^Host network$/i })
      ).toBeInTheDocument()
      expect(screen.queryByText('hosting WAVES-AB12CD')).not.toBeInTheDocument()
    })

    it('surfaces the host rejection string verbatim as a toast', async () => {
      radio.radioHost.mockRejectedValue(
        'radio refused to start: group owner failed (is Mobile Hotspot on?)'
      )
      const user = userEvent.setup()
      await openPanel(user)

      await user.click(screen.getByRole('button', { name: /^Host network$/i }))

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'radio refused to start: group owner failed (is Mobile Hotspot on?)'
        )
      })
      // Still idle — no phantom hosting state.
      expect(
        screen.getByRole('button', { name: /^Host network$/i })
      ).toBeEnabled()
    })

    it('translates radio-requires-windows into a friendly toast', async () => {
      radio.radioHost.mockRejectedValue('radio-requires-windows')
      const user = userEvent.setup()
      await openPanel(user)

      await user.click(screen.getByRole('button', { name: /^Host network$/i }))

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('WiFi-Direct requires Windows')
      })
    })
  })

  describe('joining', () => {
    it('shows a busy state while radio_join scans, then the connected row', async () => {
      let resolveJoin
      radio.radioJoin.mockImplementation(
        () => new Promise((resolve) => { resolveJoin = resolve })
      )
      const user = userEvent.setup()
      await openPanel(user)

      await user.click(screen.getByRole('button', { name: /^Join network$/i }))

      expect(radio.radioJoin).toHaveBeenCalledWith('AB12CD')
      const busy = await screen.findByRole('button', { name: /Joining/i })
      expect(busy).toBeDisabled()

      await act(async () => {
        resolveJoin()
      })

      expect(
        await screen.findByText('connected to WAVES-AB12CD')
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Leave$/i })).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /Join network/i })
      ).not.toBeInTheDocument()
    })

    it('leaves the network and returns to the Join button', async () => {
      const user = userEvent.setup()
      await openPanel(user)
      await user.click(screen.getByRole('button', { name: /^Join network$/i }))
      await screen.findByText('connected to WAVES-AB12CD')

      await user.click(screen.getByRole('button', { name: /^Leave$/i }))

      expect(radio.radioLeave).toHaveBeenCalledTimes(1)
      expect(
        await screen.findByRole('button', { name: /^Join network$/i })
      ).toBeInTheDocument()
    })

    it('surfaces the join rejection string verbatim as a toast', async () => {
      radio.radioJoin.mockRejectedValue('timed out scanning for WAVES-AB12CD')
      const user = userEvent.setup()
      await openPanel(user)

      await user.click(screen.getByRole('button', { name: /^Join network$/i }))

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'timed out scanning for WAVES-AB12CD'
        )
      })
      expect(
        screen.getByRole('button', { name: /^Join network$/i })
      ).toBeEnabled()
    })
  })

  describe('extend mesh (host while joined)', () => {
    it('hosts through the same command when the adapter supports GO+STA', async () => {
      const user = userEvent.setup()
      await openPanel(user)

      const extend = screen.getByRole('button', { name: /Extend mesh/i })
      expect(extend).toBeEnabled()
      await user.click(extend)

      expect(radio.radioHost).toHaveBeenCalledWith('AB12CD')
      expect(await screen.findByText('hosting WAVES-AB12CD')).toBeInTheDocument()
    })

    it('is disabled with an explanation when goStaConcurrency is false', async () => {
      radio.radioCaps.mockResolvedValue({
        ...supportedCaps,
        goStaConcurrency: false,
      })
      const user = userEvent.setup()
      await openPanel(user)

      const extend = screen.getByRole('button', { name: /Extend mesh/i })
      expect(extend).toBeDisabled()
      expect(extend).toHaveAttribute(
        'title',
        "adapter can't host while connected"
      )
      expect(
        screen.getByText("adapter can't host while connected")
      ).toBeInTheDocument()
    })
  })

  describe('unmount cleanup', () => {
    it('stops hosting and leaves best-effort on unmount', async () => {
      const user = userEvent.setup()
      const { unmount } = await openPanel(user)
      await user.click(screen.getByRole('button', { name: /^Host network$/i }))
      await screen.findByText('hosting WAVES-AB12CD')
      await user.click(screen.getByRole('button', { name: /^Join network$/i }))
      await screen.findByText('connected to WAVES-AB12CD')

      // Teardown failures must be swallowed (fire-and-forget).
      radio.radioStopHost.mockRejectedValue('radio-requires-windows')
      radio.radioLeave.mockRejectedValue('radio-requires-windows')
      unmount()

      expect(radio.radioStopHost).toHaveBeenCalledTimes(1)
      expect(radio.radioLeave).toHaveBeenCalledTimes(1)
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('does nothing on unmount when idle', async () => {
      const user = userEvent.setup()
      const { unmount } = await openPanel(user)

      unmount()

      expect(radio.radioStopHost).not.toHaveBeenCalled()
      expect(radio.radioLeave).not.toHaveBeenCalled()
    })
  })
})
