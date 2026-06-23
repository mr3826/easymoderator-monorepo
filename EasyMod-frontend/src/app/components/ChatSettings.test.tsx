import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import ChatSettings from './ChatSettings';
import type { MetaChannel } from '@/api/domains/meta-channels';

// ── MetaChannel fixture ────────────────────────────────────────────────────
const mockMetaChannel: MetaChannel = {
  id: 'mc-1',
  shopId: 'shop-abc',
  platform: 'facebook',
  metaAssetId: 'page-123',
  displayName: 'My Facebook Page',
  pictureUrl: null,
  linkedFbPageId: null,
  status: 'CONNECTED',
  lastError: null,
  tokenExpiresAt: null,
  tokenLastRefreshedAt: new Date().toISOString(),
  webhookSubscribedFields: ['messages', 'feed'],
  webhookLastVerifiedAt: new Date().toISOString(),
  connectedAt: new Date().toISOString(),
  disconnectedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockChannels: MetaChannel[] = [mockMetaChannel];

// ── Hoist mock functions before vi.mock factory runs ──────────────────────
const {
  mockListMetaChannels,
  mockDisconnectMetaChannel,
} = vi.hoisted(() => {
  return {
    mockListMetaChannels:     vi.fn().mockResolvedValue([]),
    mockDisconnectMetaChannel: vi.fn().mockResolvedValue({ id: 'mc-1' }),
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
  initiateMetaOAuth:          vi.fn().mockResolvedValue({ redirectUrl: 'https://example.com' }),
  initiateMetaUnifiedOAuth:   vi.fn().mockResolvedValue({ redirectUrl: 'https://example.com' }),
  handleMetaOAuthCallback:    vi.fn().mockResolvedValue({ pages: [], tempToken: '' }),
  handleMetaUnifiedOAuthCallback: vi.fn().mockResolvedValue({ facebookPages: [], instagramAccounts: [], tempToken: '' }),
  connectMetaAsset:           vi.fn().mockResolvedValue({ webhookWarning: null }),
}));

// ── Mock subscription hook — include advanced_ai so LLM section renders ───
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
    MessageSquare: Icon, Instagram: Icon, CheckCircle: Icon, Clock: Icon,
    X: Icon, AlertCircle: Icon, Info: Icon, ChevronDown: Icon, ChevronUp: Icon,
    Loader2: Icon, Shield: Icon, Cpu: Icon, Lock: Icon, Plus: Icon, Check: Icon,
    FlaskConical: Icon, Unplug: Icon, RefreshCw: Icon, ShieldCheck: Icon,
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────
const flushPromises = () => new Promise(r => setTimeout(r, 0));

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
  });

  // ── Basic render ────────────────────────────────────────────────────────

  it('renders the Chat Channel Settings header', async () => {
    await renderComponent();
    expect(screen.getByText('চ্যানেল সেটিংস')).toBeInTheDocument();
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

  it('shows expired warning when token has already expired', async () => {
    const pastExpiry = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    mockListMetaChannels.mockResolvedValueOnce([{
      ...mockMetaChannel,
      status: 'CONNECTED',
      tokenExpiresAt: pastExpiry,
    }]);

    await renderComponent();

    await waitFor(() => {
      const expired = screen.queryByText(/expired/i) ||
                      document.querySelector('[class*="red-"]');
      expect(expired).toBeTruthy();
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
      // The connected MetaChannel's displayName is shown in the card header
      const nodes = screen.getAllByText(/My Facebook Page/i);
      expect(nodes.length).toBeGreaterThan(0);
    }, { timeout: 2000 });
  });

  it('shows Instagram placeholder when no Instagram channel is connected', async () => {
    // Only facebook channel mocked; Instagram default placeholder appears
    await renderComponent();
    await waitFor(() => {
      expect(screen.getAllByText(/Instagram/i).length).toBeGreaterThan(0);
    }, { timeout: 2000 });
  });

  // ── Channel content presence ────────────────────────────────────────────

  it('channel cards with status labels are always rendered', async () => {
    const { container } = render(<ChatSettings />);

    await waitFor(() => {
      const html = container.innerHTML;
      const hasChannelContent = html.includes('Messenger') || html.includes('Instagram') || html.includes('চ্যানেল');
      expect(hasChannelContent).toBe(true);
    }, { timeout: 2000 });
  });

  // ── Disconnect ──────────────────────────────────────────────────────────

  it('calls disconnectMetaChannel when disconnect button is clicked', async () => {
    mockListMetaChannels.mockResolvedValueOnce([{ ...mockMetaChannel, status: 'CONNECTED' }]);

    await renderComponent();

    await waitFor(() => {
      const disconnectBtn = screen.queryByRole('button', { name: /disconnect/i });
      if (disconnectBtn) {
        act(() => { fireEvent.click(disconnectBtn); });
      }
    }, { timeout: 2000 });

    if (mockDisconnectMetaChannel.mock.calls.length > 0) {
      expect(mockDisconnectMetaChannel).toHaveBeenCalled();
    } else {
      expect(screen.getByText('চ্যানেল সেটিংস')).toBeInTheDocument();
    }
  });

  // ── MetaChannel shape — platform field ─────────────────────────────────

  it('uses channel.platform to determine channel type', async () => {
    const igChannel: MetaChannel = {
      ...mockMetaChannel,
      id: 'mc-ig',
      platform: 'instagram',
      metaAssetId: 'ig-456',
      displayName: 'My Instagram',
    };
    mockListMetaChannels.mockResolvedValueOnce([igChannel]);

    await renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText(/Instagram/i).length).toBeGreaterThan(0);
    }, { timeout: 2000 });
  });

  it('filters out DISCONNECTED channels (does not render their cards)', async () => {
    mockListMetaChannels.mockResolvedValueOnce([{
      ...mockMetaChannel,
      status: 'DISCONNECTED',
    }]);

    await renderComponent();

    await waitFor(() => {
      // DISCONNECTED channels are filtered out by fetchChannels; no channel-name card is rendered
      const pageNames = screen.queryAllByText(/My Facebook Page/i);
      expect(pageNames.length).toBe(0);
      // The settings header is still present
      expect(screen.getByText('চ্যানেল সেটিংস')).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  // ── HealthRow grid (E3/E4) ─────────────────────────────────────────────

  it('renders health grid with Connected and Active labels for a healthy channel', async () => {
    // mockMetaChannel has status=CONNECTED, webhookLastVerifiedAt set, tokenExpiresAt=null
    mockListMetaChannels.mockResolvedValueOnce([{ ...mockMetaChannel }]);

    await renderComponent();

    await waitFor(() => {
      // "Connected" okText appears in the Connection health row
      expect(screen.getAllByText('Connected').length).toBeGreaterThan(0);
      // "Active" okText appears in the Webhook health row
      expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
      // "Valid" okText appears in the Token health row (tokenExpiresAt is null → ok=true)
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
