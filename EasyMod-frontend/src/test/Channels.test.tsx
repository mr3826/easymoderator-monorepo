/**
 * ChatSettings (formerly Channels) — component integration tests.
 *
 * The Channels component was merged into ChatSettings.tsx in Phase 5.
 * The primary connect entry-point is now the unified FB+IG OAuth button
 * (handleConnectUnified), not per-platform "Connect Channel" buttons.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import ChatSettings from '@/app/components/ChatSettings'
import { toast } from 'sonner'
import type { MetaChannel, MetaOAuthCallbackResult, MetaUnifiedCallbackResult } from '@/api/domains/meta-channels'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, _options?: any) => {
      const map: Record<string, string> = {
        'channels.errors.oauthStateMismatch': 'OAuth validation failed — please try again',
        'channels.errors.connectionFailed': 'Connection failed — please try again',
        'channels.errors.oauthInitFailed': 'Could not start connection',
      }
      return map[key] ?? key
    },
  }),
}))

// ── Hoist mocks ────────────────────────────────────────────────────────────────
const {
  mockListMetaChannels,
  mockInitiateMetaUnifiedOAuth,
  mockHandleMetaUnifiedOAuthCallback,
  mockConnectMetaAsset,
} = vi.hoisted(() => ({
  mockListMetaChannels:               vi.fn<[], Promise<MetaChannel[]>>().mockResolvedValue([]),
  mockInitiateMetaUnifiedOAuth:       vi.fn(),
  mockHandleMetaUnifiedOAuthCallback: vi.fn(),
  mockConnectMetaAsset:               vi.fn(),
}))

// Mock the meta-channels client — must include every named export ChatSettings imports
vi.mock('@/api/domains/meta-channels', () => ({
  listMetaChannels:               mockListMetaChannels,
  initiateMetaOAuth:              vi.fn(),
  handleMetaOAuthCallback:        vi.fn(),
  initiateMetaUnifiedOAuth:       mockInitiateMetaUnifiedOAuth,
  handleMetaUnifiedOAuthCallback: mockHandleMetaUnifiedOAuthCallback,
  connectMetaAsset:               mockConnectMetaAsset,
  pingMetaChannel:                vi.fn(),
  disconnectMetaChannel:          vi.fn(),
  reconnectMetaChannel:           vi.fn(),
  getMetaChannelConsentSummary:   vi.fn(),
  updateMetaChannelPurposeLabel:  vi.fn(),
}))

vi.mock('@/app/lib/useSubscriptionFeatures', () => ({
  useSubscriptionFeatures: () => ({
    plan: null,
    features: {},
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    error:   vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}))

// BroadcastChannel is not available in happy-dom — provide a no-op stub so
// ChatSettings' unified OAuth path does not throw when it calls new BroadcastChannel().
class FakeBroadcastChannel {
  onmessage: ((e: MessageEvent) => void) | null = null
  postMessage() {}
  close() {}
}
vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)

// ─────────────────────────────────────────────────────────────────────────────

describe('ChatSettings (Channels)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListMetaChannels.mockResolvedValue([])
    // Return `window` so oauthPopupRef.current === window in the origin-filter test.
    vi.spyOn(window, 'open').mockReturnValue(window as any)
  })

  // ── 1. Render ───────────────────────────────────────────────────────────────
  it('renders the channel settings page with the unified connect button', async () => {
    await act(async () => {
      render(
        <BrowserRouter>
          <ChatSettings />
        </BrowserRouter>,
      )
    })

    // The page heading is in Bengali ("চ্যানেল সেটিংস"), surfaced as an h2.
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument()
    })

    // The primary CTA for first-time connect is the unified one-popup button.
    // It is only rendered when !isLoading && !loadError && !activeOAuth.
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Facebook.*Instagram.*একসাথে|একসাথে সংযুক্ত/i }),
      ).toBeInTheDocument()
    })
  })

  // ── 2. Origin filter — wrong-origin postMessage is ignored ─────────────────
  it('ignores OAuth postMessage events from wrong origin', async () => {
    mockInitiateMetaUnifiedOAuth.mockResolvedValue({
      redirectUrl: 'https://facebook.com/dialog/oauth',
      state: 's'.repeat(64),
    })
    mockHandleMetaUnifiedOAuthCallback.mockResolvedValue({
      facebookPages: [],
      instagramAccounts: [],
      tempToken: 't'.repeat(64),
    } as MetaUnifiedCallbackResult)

    await act(async () => {
      render(
        <BrowserRouter>
          <ChatSettings />
        </BrowserRouter>,
      )
    })

    // Click the unified connect button to open the OAuth popup
    const unifiedBtn = await screen.findByRole('button', { name: /একসাথে সংযুক্ত/i })
    fireEvent.click(unifiedBtn)

    await waitFor(() => {
      expect(mockInitiateMetaUnifiedOAuth).toHaveBeenCalledOnce()
    })

    // Dispatch a message from a hostile origin — the component's handler checks
    // e.origin !== window.location.origin and returns early.
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://evil.example.com',
        source: window as any,
        data: { type: 'OAUTH_SUCCESS', code: 'abc', state: 's'.repeat(64) },
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mockHandleMetaUnifiedOAuthCallback).not.toHaveBeenCalled()
  })

  // ── 3. Error postMessage from same origin ──────────────────────────────────
  it('handles OAuth error postMessage from same origin', async () => {
    mockInitiateMetaUnifiedOAuth.mockResolvedValue({
      redirectUrl: 'https://facebook.com/dialog/oauth',
      state: 's'.repeat(64),
    })

    await act(async () => {
      render(
        <BrowserRouter>
          <ChatSettings />
        </BrowserRouter>,
      )
    })

    const unifiedBtn = await screen.findByRole('button', { name: /একসাথে সংযুক্ত/i })
    fireEvent.click(unifiedBtn)

    // Wait for the "connecting" step UI (spinner + cancel link) to appear inside
    // the unified connect card. The spinner is rendered when
    // activeOAuth.platform === 'unified' && step === 'connecting'.
    await waitFor(() => {
      expect(screen.getByText(/পপ-আপে Meta-তে লগইন করুন/i)).toBeInTheDocument()
    })

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: window as any,
        data: { type: 'OAUTH_ERROR', error: 'OAuth denied by user' },
      }),
    )

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled()
    })
    expect(mockHandleMetaUnifiedOAuthCallback).not.toHaveBeenCalled()
  })

  // ── 4. Page-picker connect button disabled until selection ─────────────────
  it('keeps the connect button disabled until at least one asset is selected', async () => {
    mockInitiateMetaUnifiedOAuth.mockResolvedValue({
      redirectUrl: 'https://facebook.com/dialog/oauth',
      state: 's'.repeat(64),
    })
    mockHandleMetaUnifiedOAuthCallback.mockResolvedValue({
      facebookPages: [
        { id: 'page-1', name: 'Page One', platform: 'facebook', category: null, pictureUrl: null },
        { id: 'page-2', name: 'Page Two', platform: 'facebook', category: null, pictureUrl: null },
      ],
      instagramAccounts: [],
      tempToken: 't'.repeat(64),
    } as unknown as MetaUnifiedCallbackResult)

    await act(async () => {
      render(
        <BrowserRouter>
          <ChatSettings />
        </BrowserRouter>,
      )
    })

    const unifiedBtn = await screen.findByRole('button', { name: /একসাথে সংযুক্ত/i })
    fireEvent.click(unifiedBtn)

    await waitFor(() => {
      expect(mockInitiateMetaUnifiedOAuth).toHaveBeenCalledOnce()
    })

    // Simulate the OAuth popup replying with a success postMessage
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: window as any,
        data: { type: 'OAUTH_SUCCESS', code: 'abc', state: 's'.repeat(64) },
      }),
    )

    // Wait for the page-select step: "Page One" should appear in the picker
    await waitFor(() => {
      expect(screen.getByText('Page One')).toBeInTheDocument()
    })

    // The "Connect (0)" button must be disabled before any selection
    const connectBtn = screen.getByRole('button', { name: /Connect \(0\)/i })
    expect(connectBtn).toBeDisabled()

    // Selecting a checkbox enables the button — checkboxes are associated with
    // the page labels via the <label> wrapping pattern; use getByText + closest.
    const pageOneLabel = screen.getByText('Page One').closest('label') as HTMLElement
    const checkbox = pageOneLabel.querySelector('input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(checkbox)

    expect(screen.getByRole('button', { name: /Connect \(1\)/i })).not.toBeDisabled()
  })
})
