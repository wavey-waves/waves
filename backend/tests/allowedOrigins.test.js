import { describe, it, expect, beforeEach, vi } from 'vitest'

// allowedOrigins reads process.env at import time, so reset the module
// registry between cases and re-import dynamically.
describe('allowedOrigins', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.CLIENT_ORIGINS
  })

  it('includes the default localhost + production origins', async () => {
    const { allowedOrigins } = await import('../src/libs/allowedOrigins.js')
    expect(allowedOrigins).toContain('http://localhost:5173')
    expect(allowedOrigins).toContain('http://localhost:5176')
    expect(allowedOrigins).toContain('https://waves-c53a.onrender.com')
  })

  it('merges CLIENT_ORIGINS from env, trimming and de-duping', async () => {
    process.env.CLIENT_ORIGINS = 'https://a.com, https://b.com , http://localhost:5173'
    const { allowedOrigins } = await import('../src/libs/allowedOrigins.js')
    expect(allowedOrigins).toContain('https://a.com')
    expect(allowedOrigins).toContain('https://b.com')
    expect(allowedOrigins.filter((o) => o === 'http://localhost:5173')).toHaveLength(1)
  })

  it('ignores empty CLIENT_ORIGINS entries', async () => {
    process.env.CLIENT_ORIGINS = ',, ,'
    const { allowedOrigins } = await import('../src/libs/allowedOrigins.js')
    expect(allowedOrigins).not.toContain('')
  })
})
