import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import ChatSettings from './ChatSettings';
import type { MetaChannel } from '@/api/domains/meta-channels';

// ── MetaChannel fixture (Facebook-only — Instagram removed 2026-06-24) ───────
const mockMetaChannel: MetaChannel = {
  id: 'mc-1',
  shopId: 'shop-abc',
  platform: 'facebook',
  metaAssetId: 'page-123',
  displayName: 'My Facebook Page',
  pictureUrl: null,
  status: 'CONNECTED',
  lastError: null,
  tokenExpiresAt: null,
  tokenLastRefreshedAt: new Date().toISOString(),
  webhookSubscribedFields: ['messages'],
  webhookLastVerifiedAt: new Date().toISOString(),
  connectedAt: new Date().toISOString(),
  disconnectedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  purposeLabel: null,
};

const mockChannels: MetaChannel[] = [mockMetaChannel];

// ── Hoist mock functions before vi.mock factory runs ──────────────────────
const {
  mockListMetaChannels,
  mockDisconnectMetaChannel,
  mockInitiateMetaOAuth,
  mockHandleMetaOAuthCallback,
  mockConnectMetaAsset,
} = vi.hoisted(() => {
  return {
    mockListMetaChannels:      vi.fn().mockResolvedValue([]),
    mockDisconnectMetaChannel: vi.fn().mockResolvedValue({ id: 'mc-1' }),
    mockInitiateMetaOAuth:     vi.fn().mockResolvedValue({ redirectUrl: 'https://example.com?state=state-123' }),
    mockHandleMetaOAuthCallback: vi.fn().mockResolvedValue({ pages: [], tempToken: 'tmp' }),
    mockConnectMetaAsset:      vi.fn().mockResolvedValue({ webhookWarning: null }),
  };
});

// ── Mock meta-channels client ─────────────────────────────────────────────
vi.mock('@/api/domains/meta-channels', () => ({
  listMetaChannels:           mockListMetaChannels,
  disconnectMetaChannel:      mockDisconnectMetaChannel,
  reconnectMetaChannel:       vi.fn().mockResolvedValue({ redirectUrl: 'https://example.com', state: 'st', channelId: 'mc-1', platform: 'facebook' }),
  pingMetaChannel:            vi.fn().mockResolvedValue({ ping: { ok: true, latencyMs: 10 } }),
  getMetaChannelConsentSummary: vi.fn().mockResolvedValue({ channelId: 'mc-1', counts: { optIns: 0, optOuts: 0, deauthorized: 0, dataDeleted: 0 }, recentEvents: [] }),
  updateMetaChannelPurposeLabel: vi.fn().mockResolvedValue({}),
  getMetaChannelSettings:     vi.fn().mockResolvedValue({ aiAutoReply: false }),
  updateMetaChannelSettings:  vi.fn().mockResolvedValue({ aiAutoReply: true }),
  initiateMetaOAuth:          mockInitiateMetaOAuth,
  handleMetaOAuthCallback:    mockHandleMetaOAuthCallback,
  connectMetaAsset:           mockConnectMetaAsset,
}));

// ── Mock subscription hook ────────────────────────────────────────────────
vi.mock('@/app/lib/useSubscriptionFeatures', () => ({
  useSubscriptionFeatures: () => ({
    canUseFeature: vi.fn().mockReturnValue(true),
    planName: 'Pro',
    plan: null,
    loading: false,
    features: { ai_chatbot: true, multi_channel: true, advanced_ai: true, image_understanding: true, priority_support: false, custom_branding: false },
  }),
}));

// ── Mock react-router-dom (Link used in ChatSettings) ─────────────────────
vi.mock('react-router-dom', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Link: ({ children, to, ...props }: any) => <a href={to} {...props}>{children}</a>,
}));

// ── Mock lucide-react icons ───────────────────────────────────────────────
vi.mock('lucide-react', () => {
  const Icon = () => null;
  return {
    MessageSquare: Icon, CheckCircle: Icon, Clock: Icon,
    X: Icon, AlertCircle: Icon, Info: Icon, ChevronDown: Icon, ChevronUp: Icon,
    Loader2: Icon, Shield: Icon, Cpu: Icon, Lock: Icon, Plus: Icon, Check: Icon,
    FlaskConical: Icon, Unplug: Icon, RefreshCw: Icon, ShieldCheck: Icon,
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────
const flushPromises = () => new Promise(r => setTimeout(r, 0));
let lastBroadcastChannel: { onmessage: ((event: { data: unknown }) => void) | null } | null = null;

const renderComponent = async () => {
  let utils: ReturnType<typeof render> | undefined;
  await act(async () => {
    utils = render(<ChatSettings />);
    await flushPromises();
  });
  return utils!;
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ChatSettings', () => {
  beforeEach(() => {
    mockListMetaChannels.mockReset().mockResolvedValue(mockChannels);
    mockDisconnectMetaChannel.mockReset().mockResolvedValue({ id: 'mc-1' });
    mockInitiateMetaOAuth.mockReset().mockResolvedValue({ redirectUrl: 'https://example.com?state=state-123' });
    mockHandleMetaOAuthCallback.mockReset().mockResolvedValue({ pages: [], tempToken: 'tmp' });
    mockConnectMetaAsset.mockReset().mockResolvedValue({ webhookWarning: null });
    lastBroadcastChannel = null;

    vi.spyOn(window, 'open').mockReturnValue({ closed: false, close: vi.fn() } as unknown as Window);
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: class {
        onmessage: ((event: { data: unknown }) => void) | null = null;
        constructor() {
          lastBroadcastChannel = this;
        }
        close = vi.fn();
        postMessage = vi.fn();
      },
    });
  });

  // ── Basic render ────────────────────────────────────────────────────────

  it('renders the Chat Channel Settings header', async () => {
    await renderComponent();
    expect(screen.getByText('Channel Settings')).toBeInTheDocument();
  });

  it('makes API call to load channels on mount', async () => {
    await renderComponent();
    await waitFor(() => {
      expect(mockListMetaChannels).toHaveBeenCalled();
    }, { timeout: 2000 });
  });

  // ── Token expiry badge ──────────────────────────────────────────────────

  it('shows expiry warning when channel has future tokenExpiresAt', async () => {
    const futureExpiry = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    mockListMetaChannels.mockResolvedValueOnce([{
      ...mockMetaChannel,
      status: 'CONNECTED',
      tokenExpiresAt: futureExpiry,
    }]);

    await renderComponent();

    await waitFor(() => {
      const warning = screen.queryByText(/day/i) ||
                      screen.queryByText(/expir/i) ||
                      document.querySelector('[class*="amber"]') ||
                      document.querySelector('[class*="yellow"]');
      expect(warning).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('does not show expiry badge when tokenExpiresAt is null', async () => {
    mockListMetaChannels.mockResolvedValueOnce([{
      ...mockMetaChannel,
      status: 'CONNECTED',
      tokenExpiresAt: null,
    }]);

    await renderComponent();

    const noExpiry = screen.queryByText(/token.*expir/i);
    expect(noExpiry).toBeNull();
  });

  // ── Channel cards ───────────────────────────────────────────────────────

  it('renders connected channel display name in card', async () => {
    await renderComponent();
    await waitFor(() => {
      const nodes = screen.getAllByText(/My Facebook Page/i);
      expect(nodes.length).toBeGreaterThan(0);
    }, { timeout: 2000 });
  });

  it('shows the Facebook connect button when no channel is connected', async () => {
    mockListMetaChannels.mockResolvedValueOnce([]);
    await renderComponent();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Connect Facebook Page/i })).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  it('shows the "add another Facebook Page" button when a channel is already connected', async () => {
    await renderComponent();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add another Facebook Page/i })).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  // ── Multi-page connect (single OR multiple Pages at once) ────────────────

  it('connects multiple Facebook Pages selected in the picker', async () => {
    mockListMetaChannels.mockResolvedValue([]);
    mockHandleMetaOAuthCallback.mockResolvedValue({
      pages: [
        { id: 'p1', name: 'Page One', category: null, pictureUrl: null },
        { id: 'p2', name: 'Page Two', category: null, pictureUrl: null },
      ],
      tempToken: 'tmp-xyz',
    });

    await renderComponent();

    fireEvent.click(await screen.findByRole('button', { name: /Connect Facebook Page/i }));
    await waitFor(() => expect(mockInitiateMetaOAuth).toHaveBeenCalledWith('facebook'));

    await act(async () => {
      lastBroadcastChannel?.onmessage?.({
        data: { type: 'OAUTH_SUCCESS', code: 'code-123', state: 'state-123' },
      });
      await flushPromises();
    });

    // Both pages appear in the multi-select picker
    expect(await screen.findByText('Page One')).toBeInTheDocument();
    expect(await screen.findByText('Page Two')).toBeInTheDocument();

    // Select both pages
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(2);
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    // Connect button reflects the selection count
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Connect \(2\)/i }));
      await flushPromises();
    });

    // Each selected Page is persisted via its own connectMetaAsset call (platform=facebook)
    await waitFor(() => expect(mockConnectMetaAsset).toHaveBeenCalledTimes(2));
    expect(mockConnectMetaAsset).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'p1', platform: 'facebook' }));
    expect(mockConnectMetaAsset).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'p2', platform: 'facebook' }));
  });

  // ── Disconnect ──────────────────────────────────────────────────────────

  it('calls disconnectMetaChannel when disconnect is confirmed', async () => {
    mockListMetaChannels.mockResolvedValue([{ ...mockMetaChannel, status: 'CONNECTED' }]);

    await renderComponent();

    const disconnectBtn = await screen.findByRole('button', { name: /disconnect/i });
    await act(async () => { fireEvent.click(disconnectBtn); });
    // Confirm in the modal
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Yes, Disconnect/i })); });

    await waitFor(() => expect(mockDisconnectMetaChannel).toHaveBeenCalledWith('mc-1'));
  });

  it('filters out DISCONNECTED channels (does not render their cards)', async () => {
    mockListMetaChannels.mockResolvedValueOnce([{
      ...mockMetaChannel,
      status: 'DISCONNECTED',
    }]);

    await renderComponent();

    await waitFor(() => {
      const pageNames = screen.queryAllByText(/My Facebook Page/i);
      expect(pageNames.length).toBe(0);
      expect(screen.getByText('Channel Settings')).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  it('explains Meta Business access when OAuth returns no Pages', async () => {
    mockListMetaChannels.mockResolvedValue([]);
    mockHandleMetaOAuthCallback.mockResolvedValue({ pages: [], tempToken: '' });

    await renderComponent();

    fireEvent.click(await screen.findByRole('button', { name: /Connect Facebook Page/i }));

    await waitFor(() => {
      expect(mockInitiateMetaOAuth).toHaveBeenCalledWith('facebook');
      expect(lastBroadcastChannel).not.toBeNull();
    });

    await act(async () => {
      lastBroadcastChannel?.onmessage?.({
        data: { type: 'OAUTH_SUCCESS', code: 'code-123', state: 'state-123' },
      });
      await flushPromises();
    });

    expect(await screen.findByText('No Facebook Page found')).toBeInTheDocument();
    expect(screen.getByText(/usually a Meta Business access issue/i)).toBeInTheDocument();
    expect(screen.getByText('Open Meta Business Settings')).toBeInTheDocument();
  });

  // ── HealthRow grid ─────────────────────────────────────────────────────

  it('renders health grid with Connected and Active labels for a healthy channel', async () => {
    mockListMetaChannels.mockResolvedValueOnce([{ ...mockMetaChannel }]);

    await renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText('Connected').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Valid').length).toBeGreaterThan(0);
    }, { timeout: 2000 });
  });

  it('renders Action Required badge for webhook_subscription_unverified error', async () => {
    mockListMetaChannels.mockResolvedValueOnce([{
      ...mockMetaChannel,
      status: 'ERROR',
      lastError: 'webhook_subscription_unverified',
    }]);

    await renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Action Required')).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  it('renders generic Error badge for non-actionable ERROR status', async () => {
    mockListMetaChannels.mockResolvedValueOnce([{
      ...mockMetaChannel,
      status: 'ERROR',
      lastError: 'some_other_error',
    }]);

    await renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Error')).toBeInTheDocument();
      expect(screen.queryByText('Action Required')).toBeNull();
    }, { timeout: 2000 });
  });
});
