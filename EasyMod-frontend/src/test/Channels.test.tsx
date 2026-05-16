import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import Channels from '@/app/components/Channels'
import { apiClient } from '@/api'
import { toast } from 'sonner'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => {
      if (options?.returnObjects) return []
      const map: Record<string, string> = {
        'channels.title': 'Channels',
        'channels.subtitle': 'Manage your connected channels',
        'channels.connectChannel': 'Connect Channel',
        'channels.noChannels': 'No channels yet',
        'channels.noChannelsHint': 'Connect a channel to get started',
        'channels.errorTitle': 'Error',
        'channels.connectModal.title': 'Connect a Channel',
        'channels.connectModal.subtitle': 'Choose a platform to connect',
        'channels.connectModal.cancelWaiting': 'Cancel',
        'channels.connectModal.waitingMessage': 'Waiting for authorization...',
        'channels.connectModal.waitingTitle.facebook': 'Waiting for Facebook',
        'channels.connectModal.waitingTitle.instagram': 'Waiting for Instagram',
        'channels.connectModal.oauthButton.facebook': 'Connect with Facebook',
        'channels.connectModal.oauthButton.instagram': 'Connect with Instagram',
        'channels.connectModal.channels.facebook.name': 'Facebook Messenger',
        'channels.connectModal.channels.facebook.tagline': 'Connect your Facebook Page',
        'channels.connectModal.channels.instagram.name': 'Instagram',
        'channels.connectModal.channels.instagram.tagline': 'Connect your Instagram account',
        'channels.connectModal.pageSelect.title': 'Select a Page',
        'channels.connectModal.successTitle': 'Connected!',
        'channels.errors.disconnectFailed': 'Failed to disconnect channel',
      }
      return map[key] ?? key
    },
  }),
}))

// Mock the API client
vi.mock('@/api', () => ({
  apiClient: {
    getChannels: vi.fn().mockResolvedValue([]),
    initiateOAuth: vi.fn(),
    handleOAuthCallback: vi.fn(),
    connectOAuthPage: vi.fn()
  }
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

describe('Channels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Return `window` so oauthPopupRef.current === window.
    // window.dispatchEvent sets e.source = window, so the source check passes.
    vi.spyOn(window, 'open').mockReturnValue(window as any)
  })

  it('renders channels page', async () => {
    await act(async () => {
      render(
        <BrowserRouter>
          <Channels />
        </BrowserRouter>
      )
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Channels' })).toBeInTheDocument()
    })
  })

it('ignores OAuth postMessage events from wrong origin', async () => {
    ;(apiClient.initiateOAuth as any).mockResolvedValue({
      redirectUrl: 'https://facebook.com/dialog/oauth'
    })
    ;(apiClient.handleOAuthCallback as any).mockResolvedValue({
      pages: [],
      tempToken: 't'.repeat(64)
    })

    await act(async () => {
      render(
        <BrowserRouter>
          <Channels />
        </BrowserRouter>
      )
    })

    fireEvent.click(screen.getByRole('button', { name: /connect channel/i }))
    fireEvent.click(screen.getByRole('button', { name: /facebook messenger/i }))
    fireEvent.click(await screen.findByRole('button', { name: /connect with facebook/i }))

    await waitFor(() => {
      expect(apiClient.initiateOAuth).toHaveBeenCalledOnce()
    })

    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://evil.example.com',
      source: window as any,
      data: { type: 'OAUTH_SUCCESS', code: 'abc', state: 's'.repeat(64) }
    }))

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(apiClient.handleOAuthCallback).not.toHaveBeenCalled()
  })

  it('handles OAuth error postMessage from same origin', async () => {
    ;(apiClient.initiateOAuth as any).mockResolvedValue({
      redirectUrl: 'https://facebook.com/dialog/oauth'
    })

    await act(async () => {
      render(
        <BrowserRouter>
          <Channels />
        </BrowserRouter>
      )
    })

    fireEvent.click(screen.getByRole('button', { name: /connect channel/i }))
    fireEvent.click(screen.getByRole('button', { name: /facebook messenger/i }))
    fireEvent.click(await screen.findByRole('button', { name: /connect with facebook/i }))

    await screen.findByText(/Waiting for Facebook/i)

    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      source: window as any,
      data: { type: 'OAUTH_ERROR', error: 'OAuth denied by user' }
    }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled()
    })
    expect(apiClient.handleOAuthCallback).not.toHaveBeenCalled()
  })

  it('keeps page connect button disabled until at least one page is selected', async () => {
    ;(apiClient.initiateOAuth as any).mockResolvedValue({
      redirectUrl: 'https://facebook.com/dialog/oauth'
    })
    ;(apiClient.handleOAuthCallback as any).mockResolvedValue({
      pages: [
        { id: 'page-1', name: 'Page One' },
        { id: 'page-2', name: 'Page Two' }
      ],
      tempToken: 't'.repeat(64)
    })

    await act(async () => {
      render(
        <BrowserRouter>
          <Channels />
        </BrowserRouter>
      )
    })

    fireEvent.click(screen.getByRole('button', { name: /connect channel/i }))
    fireEvent.click(screen.getByRole('button', { name: /facebook messenger/i }))
    fireEvent.click(await screen.findByRole('button', { name: /connect with facebook/i }))

    await screen.findByText(/Waiting for Facebook/i)

    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      source: window as any,
      data: { type: 'OAUTH_SUCCESS', code: 'abc', state: 's'.repeat(64) }
    }))

    await waitFor(() => {
      expect(screen.getByText('Page One')).toBeInTheDocument()
    })

    const connectButtons = screen.getAllByRole('button').filter((btn) =>
      /connect/i.test(btn.textContent || '')
    )
    const pageConnectButton = connectButtons[connectButtons.length - 1]
    expect(pageConnectButton).toBeDisabled()

    fireEvent.click(screen.getByLabelText(/Page One/i))
    expect(pageConnectButton).not.toBeDisabled()
  })
})