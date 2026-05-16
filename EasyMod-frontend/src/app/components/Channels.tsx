import { useState, useEffect, useRef } from "react";
import { Plus, Check, AlertCircle, RefreshCw, Settings, Loader2, MessageSquare, Instagram, FlaskConical, Unplug } from "lucide-react";
import { apiClient } from "@/api";
import type { Channel, FacebookPage } from "@/api/types/channel";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useTranslation } from 'react-i18next';
import { useSubscriptionFeatures } from "../lib/useSubscriptionFeatures";

interface ChannelOption {
  id: 'facebook' | 'instagram' | 'whatsapp';
  name: string;
  taglineKey: string;
  brandColor: string;
  bgColor: string;
  borderColor: string;
}

const availableChannels: ChannelOption[] = [
  {
    id: 'facebook',
    name: 'Facebook Messenger',
    taglineKey: 'channels.connectModal.channels.facebook.tagline',
    brandColor: '#1877F2',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
  },
  {
    id: 'instagram',
    name: 'Instagram DM',
    taglineKey: 'channels.connectModal.channels.instagram.tagline',
    brandColor: '#E1306C',
    bgColor: 'bg-pink-50',
    borderColor: 'border-pink-200',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp Business',
    taglineKey: 'channels.connectModal.channels.whatsapp.tagline',
    brandColor: '#25D366',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
  },
];

function ChannelIcon({ id, color, size = 24 }: { id: string; color: string; size?: number }) {
  if (id === 'instagram') return <Instagram style={{ color, width: size, height: size }} />;
  return <MessageSquare style={{ color, width: size, height: size }} />;
}

export default function Channels() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<ChannelOption | null>(null);
  const [connectionStep, setConnectionStep] = useState<'select' | 'connect' | 'connecting' | 'page-select' | 'complete'>('select');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const oauthPopupRef = useRef<Window | null>(null);
  const oauthListenerRef = useRef<((e: MessageEvent) => void) | null>(null);
  const oauthInProgressRef = useRef(false); // F4: prevent concurrent OAuth flows overwriting nonce
  const [availablePages, setAvailablePages] = useState<FacebookPage[]>([]);
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set());
  const [tempToken, setTempToken] = useState('');
  const [isConnectingPage, setIsConnectingPage] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  // WhatsApp direct-token wizard state
  const [wabaId, setWabaId] = useState('');
  const [waPhoneId, setWaPhoneId] = useState('');
  const [waToken, setWaToken] = useState('');
  const [waDisplayName, setWaDisplayName] = useState('');
  const [isConnectingWa, setIsConnectingWa] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  const { plan } = useSubscriptionFeatures();

  const fetchChannels = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const fetchedChannels = await apiClient.getChannels();
      setChannels(fetchedChannels);
    } catch (error: any) {
      setError(error.response?.data?.error?.message || t('channels.errors.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchChannels();
    return () => {
      if (oauthListenerRef.current) {
        window.removeEventListener('message', oauthListenerRef.current);
      }
    };
  }, []);

  // Poll for manual popup close so the listener doesn't leak
  useEffect(() => {
    if (connectionStep !== 'connecting') return;
    const interval = setInterval(() => {
      if (oauthPopupRef.current?.closed) {
        clearInterval(interval);
        if (oauthListenerRef.current) {
          window.removeEventListener('message', oauthListenerRef.current);
          oauthListenerRef.current = null;
        }
        setConnectionStep('connect');
      }
    }, 500);
    return () => clearInterval(interval);
  }, [connectionStep]);

  const handleSelectChannel = (channel: ChannelOption) => {
    setSelectedChannel(channel);
    setConnectionStep('connect');
  };

  const OAUTH_NONCE_KEY = 'easymod_oauth_nonce';

  const handleOAuthConnect = async () => {
    if (!selectedChannel) return;
    if (oauthInProgressRef.current) {
      toast.error('An OAuth connection is already in progress. Please complete or cancel it first.');
      return;
    }
    oauthInProgressRef.current = true;
    try {
      const { redirectUrl } = await apiClient.initiateOAuth(selectedChannel.id);

      // Extract the backend-generated state from the redirect URL and store it as a nonce.
      // When Meta echoes it back through OAuthCallbackPage, we validate it matches before
      // sending the code to the backend — prevents postMessage spoofing attacks.
      try {
        const urlState = new URL(redirectUrl).searchParams.get('state');
        if (urlState) {
          sessionStorage.setItem(OAUTH_NONCE_KEY, urlState);
        }
      } catch {
        // Non-critical: if URL parsing fails we proceed without nonce validation
      }
      sessionStorage.setItem('easymod_oauth_channel_type', selectedChannel.id);

      oauthPopupRef.current = window.open(redirectUrl, 'meta_oauth', 'width=600,height=700,left=200,top=100');
      setConnectionStep('connecting');

      const handler = (e: MessageEvent) => {
        if (e.origin !== window.location.origin) return;
        if (oauthPopupRef.current && e.source !== oauthPopupRef.current) return;

        if (e.data?.type === 'OAUTH_SUCCESS') {
          // Validate state matches the nonce we stored before opening the popup
          const expectedNonce = sessionStorage.getItem(OAUTH_NONCE_KEY);
          sessionStorage.removeItem(OAUTH_NONCE_KEY);
          if (expectedNonce && e.data.state !== expectedNonce) {
            toast.error(t('channels.errors.oauthStateMismatch', 'OAuth validation failed — please try again'));
            setConnectionStep('connect');
            window.removeEventListener('message', handler);
            oauthListenerRef.current = null;
            return;
          }

          apiClient.handleOAuthCallback(e.data.code, e.data.state, selectedChannel.id)
            .then(result => {
              setAvailablePages(result.pages);
              setTempToken(result.tempToken);
              setConnectionStep('page-select');
            })
            .catch(() => {
              toast.error(t('channels.errors.connectionFailed'));
              setConnectionStep('connect');
            });
        } else if (e.data?.type === 'OAUTH_ERROR') {
          sessionStorage.removeItem(OAUTH_NONCE_KEY);
          toast.error(e.data.error || t('channels.errors.connectionFailed'));
          setConnectionStep('connect');
        }
        window.removeEventListener('message', handler);
        oauthListenerRef.current = null;
        oauthInProgressRef.current = false;
      };
      oauthListenerRef.current = handler;
      window.addEventListener('message', handler);
    } catch {
      sessionStorage.removeItem(OAUTH_NONCE_KEY);
      oauthInProgressRef.current = false;
      toast.error(t('channels.errors.oauthInitFailed'));
    }
  };

  const handleWhatsAppConnect = async () => {
    if (!wabaId || !waPhoneId || !waToken) {
      toast.error('Please fill in all WhatsApp Business API fields');
      return;
    }
    setIsConnectingWa(true);
    try {
      await apiClient.post('/channel/whatsapp/connect', {
        waba_id: wabaId.trim(),
        phone_number_id: waPhoneId.trim(),
        access_token: waToken.trim(),
        display_name: waDisplayName.trim() || 'WhatsApp'
      });
      toast.success('WhatsApp Business channel connected!');
      setShowConnectModal(false);
      setConnectionStep('select');
      setWabaId(''); setWaPhoneId(''); setWaToken(''); setWaDisplayName('');
      fetchChannels();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to connect WhatsApp');
      setWaToken(''); // Clear token on error to prevent re-submission with stale credentials
    } finally {
      setIsConnectingWa(false);
    }
  };

  const handleCancelOAuth = () => {
    oauthPopupRef.current?.close();
    oauthInProgressRef.current = false;
    if (oauthListenerRef.current) {
      window.removeEventListener('message', oauthListenerRef.current);
      oauthListenerRef.current = null;
    }
    sessionStorage.removeItem(OAUTH_NONCE_KEY);
    setConnectionStep('connect');
  };

  const togglePageSelection = (pageId: string) => {
    setSelectedPageIds(prev => {
      const next = new Set(prev);
      next.has(pageId) ? next.delete(pageId) : next.add(pageId);
      return next;
    });
  };

  const handleConnectPages = async () => {
    if (!selectedChannel || selectedPageIds.size === 0) return;
    setIsConnectingPage(true);
    try {
      let webhookWarning: string | null = null;
      for (const page of availablePages.filter(p => selectedPageIds.has(p.id))) {
        const result = await apiClient.connectOAuthPage(page.id, page.name, tempToken, selectedChannel.id);
        if ((result as any).webhookWarning) {
          webhookWarning = (result as any).webhookWarning;
        }
      }
      await fetchChannels();
      setConnectionStep('complete');
      if (webhookWarning) {
        // Small delay so the success step renders first
        setTimeout(() => toast.warning(webhookWarning!, { duration: 12000 }), 500);
      }
    } catch {
      toast.error(t('channels.errors.connectionFailed'));
    } finally {
      setIsConnectingPage(false);
    }
  };

  const handleCloseModal = () => {
    handleCancelOAuth();
    setShowConnectModal(false);
    setConnectionStep('select');
    setSelectedChannel(null);
    setAvailablePages([]);
    setSelectedPageIds(new Set());
    setTempToken('');
  };

  const handleTestPipeline = async (channelId: string) => {
    setTestingId(channelId);
    try {
      const result = await apiClient.testChannelPipeline(channelId);
      if (result.pipeline_ok) {
        toast.success(
          result.meta_integration.found
            ? `✓ Backend works. If messages still don't arrive → check Facebook App Dashboard: webhook URL must be https://api.easymod.tech/webhooks/meta/`
            : `Backend pipeline OK but MetaIntegration missing. Disconnect and reconnect the channel.`,
          { duration: 15000 }
        );
      } else {
        toast.error(`Pipeline error: ${result.error} — ${result.hint}`, { duration: 15000 });
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e?.response?.data?.error ?? 'Test failed — check backend logs');
    } finally {
      setTestingId(null);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const fetchedChannels = await apiClient.getChannels();
      setChannels(fetchedChannels);
      toast.success(t('channels.refreshed'));
    } catch {
      toast.error(t('channels.errors.refreshFailed'));
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDisconnect = async (channelId: string, channelName: string) => {
    if (!window.confirm(`Disconnect "${channelName}"? The channel will stop receiving messages immediately.`)) return;
    setDisconnectingId(channelId);
    try {
      await apiClient.disconnectChannel(channelId);
      toast.success(t('channels.disconnected', 'Channel disconnected'));
      await fetchChannels();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t('channels.errors.disconnectFailed', 'Failed to disconnect channel'));
    } finally {
      setDisconnectingId(null);
    }
  };

  const getOAuthButtonLabel = (id: string) => {
    const labels: Record<string, string> = {
      facebook: t('channels.connectModal.oauthButton.facebook'),
      instagram: t('channels.connectModal.oauthButton.instagram'),
    };
    return labels[id] || t('channels.connectModal.connectButton');
  };

  const getWaitingTitle = (id: string) => {
    const titles: Record<string, string> = {
      facebook: t('channels.connectModal.waitingTitle.facebook'),
      instagram: t('channels.connectModal.waitingTitle.instagram'),
    };
    return titles[id] || t('channels.connectModal.waitingTitle.facebook');
  };

  const steps: Array<'select' | 'connect' | 'page-select' | 'complete'> = ['select', 'connect', 'page-select', 'complete'];
  const stepLabels = [
    t('channels.connectModal.steps.select'),
    t('channels.connectModal.steps.connect'),
    t('channels.connectModal.steps.pageSelect'),
    t('channels.connectModal.steps.complete'),
  ];
  const currentStepIndex = connectionStep === 'connecting' ? 1 : steps.indexOf(connectionStep as any);

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-6 md:mb-8 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{t('channels.title')}</h1>
          <p className="text-gray-600 mt-1 text-sm md:text-base">{t('channels.subtitle')}</p>
        </div>
        <button
          onClick={() => setShowConnectModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors bg-blue-600 text-white hover:bg-blue-700"
        >
          <Plus className="w-5 h-5" />
          {t('channels.connectChannel')}
        </button>
      </div>

      {/* Connected Channels */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl p-6 border border-gray-200">
              <div className="animate-pulse">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-gray-200 rounded-full"></div>
                    <div>
                      <div className="h-4 bg-gray-200 rounded w-32 mb-2"></div>
                      <div className="h-3 bg-gray-200 rounded w-24"></div>
                    </div>
                  </div>
                  <div className="h-6 bg-gray-200 rounded-full w-20"></div>
                </div>
                <div className="space-y-2">
                  <div className="h-3 bg-gray-200 rounded w-full"></div>
                  <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-6 h-6 text-red-600" />
            <div>
              <h3 className="font-semibold text-red-900">{t('channels.errorTitle')}</h3>
              <p className="text-red-700">{error}</p>
            </div>
          </div>
          <button
            onClick={() => fetchChannels()}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            {t('common.retry')}
          </button>
        </div>
      ) : channels.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-12 text-center">
          <div className="flex justify-center gap-3 mb-4">
            <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center">
              <MessageSquare className="w-7 h-7 text-[#1877F2]" />
            </div>
            <div className="w-14 h-14 rounded-full bg-pink-50 flex items-center justify-center">
              <Instagram className="w-7 h-7 text-[#E1306C]" />
            </div>
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">{t('channels.noChannels')}</h3>
          <p className="text-gray-600 mb-6">{t('channels.noChannelsHint')}</p>
          <button
            onClick={() => setShowConnectModal(true)}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 mx-auto"
          >
            <Plus className="w-5 h-5" />
            {t('channels.connectFirst')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {channels.map((channel) => {
            const channelOption = availableChannels.find(c => c.id === channel.type);
            return (
              <div key={channel.id} className="bg-white rounded-xl p-6 border border-gray-200 hover:shadow-lg transition-shadow">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center ${channelOption?.bgColor || 'bg-gray-100'}`}>
                      <ChannelIcon id={channel.type || ''} color={channelOption?.brandColor || '#6b7280'} size={22} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{channel.name}</h3>
                      <p className="text-sm text-gray-500">{channelOption?.name || channel.type}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {channel.status === 'active' && (
                      <span className="flex items-center gap-1 px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm">
                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                        {t('channels.statusActive')}
                      </span>
                    )}
                    {channel.status === 'inactive' && (
                      <span className="flex items-center gap-1 px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm">
                        <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                        {t('channels.statusInactive')}
                      </span>
                    )}
                    {channel.status === 'error' && (
                      <span className="flex items-center gap-1 px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm">
                        <AlertCircle className="w-3 h-3" />
                        {t('channels.statusError')}
                      </span>
                    )}
                  </div>
                </div>

                {channel.connected && (
                  <div className="space-y-3 mb-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">{t('channels.messagesToday')}</span>
                      <span className="font-semibold text-gray-900">{channel.messageCount}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">{t('channels.lastSync')}</span>
                      <span className="font-semibold text-gray-900">{channel.lastSync}</span>
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => navigate('/app/manage-shop/chat-settings')}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center justify-center gap-2"
                  >
                    <Settings className="w-4 h-4" />
                    {t('channels.configure')}
                  </button>
                  <button
                    onClick={() => handleTestPipeline(channel.id)}
                    disabled={testingId === channel.id}
                    title="Test pipeline — sends a real message through the backend to verify conversations are created"
                    className="px-3 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-60"
                  >
                    {testingId === channel.id
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <FlaskConical className="w-4 h-4" />}
                  </button>
                  {channel.connected && (
                    <button
                      onClick={handleRefresh}
                      disabled={isRefreshing}
                      className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-60"
                    >
                      <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                    </button>
                  )}
                  <button
                    onClick={() => handleDisconnect(channel.id, channel.name)}
                    disabled={disconnectingId === channel.id}
                    title="Disconnect channel"
                    className="px-3 py-2 border border-red-200 text-red-500 rounded-lg hover:bg-red-50 disabled:opacity-60 transition-colors"
                  >
                    {disconnectingId === channel.id
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Unplug className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Connect Channel Modal */}
      {showConnectModal && (
        <div
          className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4"
          onKeyDown={(e) => { if (e.key === 'Escape') handleCloseModal(); }}
          onClick={(e) => { if (e.target === e.currentTarget) handleCloseModal(); }}
        >
          <div className="bg-white rounded-xl p-6 md:p-8 max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold text-gray-900 mb-1">{t('channels.connectModal.title')}</h2>
            <p className="text-gray-500 mb-6 text-sm">{t('channels.connectModal.subtitle')}</p>

            {/* Step Indicator */}
            <div className="flex items-center justify-center mb-8 gap-0">
              {stepLabels.map((label, index) => {
                const isActive = index <= currentStepIndex;
                const isDone = index < currentStepIndex;
                return (
                  <div key={label} className="flex items-center">
                    <div className="flex flex-col items-center">
                      <div className={`flex items-center justify-center w-9 h-9 rounded-full text-sm font-semibold ${
                        isActive ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'
                      }`}>
                        {isDone ? <Check className="w-4 h-4" /> : index + 1}
                      </div>
                      <span className={`text-xs mt-1 whitespace-nowrap ${isActive ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
                        {label}
                      </span>
                    </div>
                    {index < stepLabels.length - 1 && (
                      <div className={`w-16 h-0.5 mb-4 ${index < currentStepIndex ? 'bg-blue-600' : 'bg-gray-200'}`} />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Step: Select Channel */}
            {connectionStep === 'select' && (
              <div className="space-y-3">
                {availableChannels.map((channel) => (
                  <button
                    key={channel.id}
                    onClick={() => handleSelectChannel(channel)}
                    className="w-full p-4 border-2 border-gray-200 rounded-xl transition-all text-left group hover:border-blue-400 cursor-pointer"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-full ${channel.bgColor} flex items-center justify-center flex-shrink-0`}>
                        <ChannelIcon id={channel.id} color={channel.brandColor} size={22} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900">{t(`channels.connectModal.channels.${channel.id}.name`)}</h3>
                        <p className="text-sm text-gray-500 truncate">{t(`channels.connectModal.channels.${channel.id}.description`)}</p>
                      </div>
                      <span className="text-sm text-blue-500 font-medium opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        {t('channels.connectModal.selectButton')} →
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Step: Connect — WhatsApp wizard (no OAuth) */}
            {connectionStep === 'connect' && selectedChannel?.id === 'whatsapp' && (
              <div>
                <div className="text-center mb-5">
                  <div className="w-20 h-20 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-3">
                    <MessageSquare className="w-9 h-9 text-green-600" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900">WhatsApp Business API</h3>
                  <p className="text-sm text-gray-500 mt-1">Connect your WhatsApp Business account using your permanent API credentials.</p>
                </div>

                {/* Meta policy notice */}
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 mb-4 text-xs text-amber-800">
                  <p className="font-semibold mb-1">Meta Policy Notice</p>
                  <ul className="space-y-1 list-disc list-inside">
                    <li>Only pre-approved message templates can be sent outside the 24-hour customer messaging window.</li>
                    <li>If a customer sends STOP, they will be opted out and will not receive messages.</li>
                    <li>Violation of Meta's commerce or messaging policy may result in your number being banned.</li>
                  </ul>
                </div>

                <div className="space-y-3 mb-5">
                  <div>
                    <label className="text-xs font-medium text-gray-700 mb-1 block">WhatsApp Business Account ID (WABA ID)</label>
                    <input
                      type="text"
                      value={wabaId}
                      onChange={e => setWabaId(e.target.value)}
                      placeholder="e.g. 1234567890123456"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700 mb-1 block">Phone Number ID</label>
                    <input
                      type="text"
                      value={waPhoneId}
                      onChange={e => setWaPhoneId(e.target.value)}
                      placeholder="e.g. 9876543210"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700 mb-1 block">Permanent Access Token</label>
                    <input
                      type="password"
                      value={waToken}
                      onChange={e => setWaToken(e.target.value)}
                      placeholder="System user permanent token"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700 mb-1 block">Display Name (optional)</label>
                    <input
                      type="text"
                      value={waDisplayName}
                      onChange={e => setWaDisplayName(e.target.value)}
                      placeholder="e.g. My Shop WA"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                </div>

                <button
                  onClick={handleWhatsAppConnect}
                  disabled={isConnectingWa || !wabaId || !waPhoneId || !waToken}
                  className="w-full py-3 rounded-xl bg-green-600 hover:bg-green-700 text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2 transition-colors mb-3"
                >
                  {isConnectingWa ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                  Connect WhatsApp
                </button>
                <button onClick={handleCloseModal} className="w-full py-2 text-sm text-gray-500 hover:text-gray-700">
                  Cancel
                </button>
              </div>
            )}

            {/* Step: Connect (OAuth) — Facebook / Instagram */}
            {connectionStep === 'connect' && selectedChannel && selectedChannel.id !== 'whatsapp' && (
              <div>
                <div className="text-center mb-6">
                  <div className={`w-20 h-20 rounded-full ${selectedChannel.bgColor} flex items-center justify-center mx-auto mb-3`}>
                    <ChannelIcon id={selectedChannel.id} color={selectedChannel.brandColor} size={36} />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900">{t(`channels.connectModal.channels.${selectedChannel.id}.name`)}</h3>
                  <p className="text-sm text-gray-500 mt-1">{t(`channels.connectModal.channels.${selectedChannel.id}.tagline`)}</p>
                </div>

                {/* Permissions disclosure — required by Meta app review */}
                <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 mb-5 text-xs text-gray-700">
                  <p className="font-semibold text-gray-800 mb-2">Permissions EasyMod will request:</p>
                  <ul className="space-y-1 list-disc list-inside">
                    {selectedChannel.id === 'facebook' && <>
                      <li><strong>pages_show_list</strong> — see which Pages you manage</li>
                      <li><strong>pages_messaging</strong> — send and receive Messenger messages on your behalf</li>
                      <li><strong>pages_read_engagement</strong> — read Page content and conversations</li>
                      <li><strong>pages_manage_metadata</strong> — subscribe to webhooks so messages arrive in real time</li>
                    </>}
                    {selectedChannel.id === 'instagram' && <>
                      <li><strong>instagram_basic</strong> — access your Instagram Business account</li>
                      <li><strong>instagram_manage_messages</strong> — read and reply to Instagram DMs</li>
                      <li><strong>pages_show_list</strong> — identify the Facebook Page linked to your Instagram</li>
                      <li><strong>pages_read_engagement</strong> — receive message delivery and read receipts</li>
                      <li><strong>pages_manage_metadata</strong> — subscribe to webhooks for real-time DM delivery</li>
                    </>}
                  </ul>
                  <p className="mt-2 text-gray-500">EasyMod only uses these permissions to receive and respond to customer messages. We never post on your behalf or access unrelated data.</p>
                </div>

                {/* OAuth Button */}
                <button
                  onClick={handleOAuthConnect}
                  style={{ backgroundColor: selectedChannel.brandColor }}
                  className="w-full py-3.5 text-white rounded-xl font-semibold text-base flex items-center justify-center gap-3 hover:opacity-90 transition-opacity shadow-sm mb-5"
                >
                  <div className="w-5 h-5">
                    <ChannelIcon id={selectedChannel.id} color="white" size={20} />
                  </div>
                  {getOAuthButtonLabel(selectedChannel.id)}
                </button>

                {/* How it works */}
                <div className={`${selectedChannel.bgColor} ${selectedChannel.borderColor} border rounded-xl p-4 mb-5`}>
                  <h4 className="text-sm font-semibold text-gray-800 mb-3">{t('channels.connectModal.oauthHowItWorks')}</h4>
                  <ul className="space-y-2">
                    {(t(`channels.connectModal.oauthSteps.${selectedChannel.id}`, { returnObjects: true }) as string[]).map((step, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                        <span className="w-5 h-5 rounded-full bg-white border flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5" style={{ borderColor: selectedChannel.brandColor, color: selectedChannel.brandColor }}>
                          {i + 1}
                        </span>
                        {step}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Privacy note */}
                <p className="text-xs text-gray-400 text-center">
                  🔒 {t('channels.connectModal.oauthPrivacyNote')}
                </p>

                <button
                  onClick={handleCloseModal}
                  className="w-full mt-4 py-2 text-sm text-gray-500 hover:text-gray-700"
                >
                  {t('common.cancel')}
                </button>
              </div>
            )}

            {/* Step: Connecting (popup open) */}
            {connectionStep === 'connecting' && selectedChannel && (
              <div className="text-center py-10">
                <div className={`w-20 h-20 rounded-full ${selectedChannel.bgColor} flex items-center justify-center mx-auto mb-5 animate-pulse`}>
                  <Loader2 className="w-10 h-10 animate-spin" style={{ color: selectedChannel.brandColor }} />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">{getWaitingTitle(selectedChannel.id)}</h3>
                <p className="text-gray-500 text-sm mb-6">{t('channels.connectModal.waitingMessage')}</p>
                <button
                  onClick={handleCancelOAuth}
                  className="text-sm text-gray-400 hover:text-gray-600 underline"
                >
                  {t('channels.connectModal.cancelWaiting')}
                </button>
              </div>
            )}

            {/* Step: Page Select */}
            {connectionStep === 'page-select' && selectedChannel && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">
                  {t('channels.connectModal.pageSelect.title')}
                </h3>
                <p className="text-sm text-gray-500 mb-4">
                  {t('channels.connectModal.pageSelect.hint')}
                </p>

                {availablePages.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 text-sm">
                    {selectedChannel.id === 'instagram'
                      ? t('channels.connectModal.pageSelect.noPagesInstagram')
                      : t('channels.connectModal.pageSelect.noPages')}
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {availablePages.map(page => (
                      <label
                        key={page.id}
                        className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors
                          ${selectedPageIds.has(page.id)
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:bg-gray-50'
                          }`}
                      >
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-blue-600 flex-shrink-0"
                          checked={selectedPageIds.has(page.id)}
                          onChange={() => togglePageSelection(page.id)}
                        />
                        {page.pictureUrl && (
                          <img src={page.pictureUrl} alt={page.name} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                        )}
                        {!page.pictureUrl && (
                          <div className={`w-9 h-9 rounded-full ${selectedChannel.bgColor} flex items-center justify-center flex-shrink-0`}>
                            <ChannelIcon id={selectedChannel.id} color={selectedChannel.brandColor} size={16} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">{page.name}</p>
                          {page.category && (
                            <p className="text-xs text-gray-500 truncate">{page.category}</p>
                          )}
                          {page.instagramAccount && (
                            <p className="text-xs text-pink-600">@{page.instagramAccount.username}</p>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                )}

                <div className="mt-5 flex gap-3">
                  <button
                    onClick={() => setConnectionStep('connect')}
                    className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    {t('channels.connectModal.back')}
                  </button>
                  <button
                    onClick={handleConnectPages}
                    disabled={selectedPageIds.size === 0 || isConnectingPage}
                    className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold
                      hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
                      flex items-center justify-center gap-2 transition-colors"
                  >
                    {isConnectingPage && <Loader2 className="w-4 h-4 animate-spin" />}
                    {t('channels.connectModal.pageSelect.connectButton', { count: selectedPageIds.size })}
                  </button>
                </div>
              </div>
            )}

            {/* Step: Complete */}
            {connectionStep === 'complete' && selectedChannel && (
              <div className="text-center py-10">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
                  <Check className="w-10 h-10 text-green-600" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">{t('channels.connectModal.successTitle')}</h3>
                <p className="text-gray-600 mb-1">
                  {t('channels.connectModal.successMessage', { channel: t(`channels.connectModal.channels.${selectedChannel.id}.name`) })}
                </p>
                <p className="text-sm text-green-600 font-medium mb-6">{t('channels.connectModal.aiActiveNotice')}</p>
                <button
                  onClick={handleCloseModal}
                  className="px-8 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-semibold"
                >
                  {t('channels.connectModal.doneButton')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
