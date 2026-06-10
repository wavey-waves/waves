import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Documentation from './Documentation'

describe('Documentation', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <Documentation isOpen={false} onClose={() => {}} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the documentation content when open', () => {
    render(<Documentation isOpen={true} onClose={() => {}} />)
    expect(
      screen.getByRole('heading', { name: /How Waves Works/i })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Understanding Peer-to-Peer/i)
    ).toBeInTheDocument()
    expect(screen.getByText(/Summary/i)).toBeInTheDocument()
  })

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<Documentation isOpen={true} onClose={onClose} />)

    await user.click(
      screen.getByRole('button', { name: /Close Documentation/i })
    )
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('mentions the WebRTC / server-relay fallback behaviour', () => {
    render(<Documentation isOpen={true} onClose={() => {}} />)
    expect(screen.getByText(/Automatic Server Fallback/i)).toBeInTheDocument()
    expect(screen.getAllByText(/WebRTC/i).length).toBeGreaterThan(0)
  })
})
