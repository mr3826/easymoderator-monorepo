import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import OAuthCallbackPage from '@/app/components/OAuthCallbackPage'

const mockUseSearchParams = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom')
  return {
    ...actual,
    useSearchParams: () => mockUseSearchParams()
  }
})

describe('OAuthCallbackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'opener', {
      configurable: true,
      value: {
        postMessage: vi.fn()
      }
    })
    vi.spyOn(window, 'close').mockImplementation(() => undefined)
  })

  it('posts OAUTH_SUCCESS and closes popup when code and state are present', async () => {
    mockUseSearchParams.mockReturnValue([
      new URLSearchParams({ code: 'code-123', state: 'state-456' })
    ])

    render(<OAuthCallbackPage />)

    await waitFor(() => {
      expect(window.opener.postMessage).toHaveBeenCalledWith(
        { type: 'OAUTH_SUCCESS', code: 'code-123', state: 'state-456' },
        window.location.origin
      )
      expect(window.close).toHaveBeenCalled()
    })
  })

  it('posts OAUTH_ERROR and closes popup when error param exists', async () => {
    mockUseSearchParams.mockReturnValue([
      new URLSearchParams({ error: 'access_denied' })
    ])

    render(<OAuthCallbackPage />)

    await waitFor(() => {
      expect(window.opener.postMessage).toHaveBeenCalledWith(
        { type: 'OAUTH_ERROR', error: 'access_denied' },
        window.location.origin
      )
      expect(window.close).toHaveBeenCalled()
    })
  })
})
