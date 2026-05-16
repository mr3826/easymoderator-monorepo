import { useEffect, useState } from "react";
import { MessageSquare, Instagram, CheckCircle, Clock, X, AlertCircle, ChevronDown, Loader2, Shield, Cpu, Lock, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { apiClient } from "@/api";
import type { Channel as BackendChannel } from "@/api/types/channel";
import { useSubscriptionFeatures } from "../lib/useSubscriptionFeatures";

interface Channel {
  id: string;
  name: string;
  type: 'facebook' | 'instagram';
  logo: React.ReactNode;
  description: string;
  status: 'connected' | 'not_connected' | 'connecting';
  connectedAccount?: string;
  lastSync?: string;
  hasToken?: boolean;
  tokenExpiresAt?: string | null;
  businessManagerId?: string;
  savedSettings?: {
    aiAutoReply?: boolean;
    requireApproval?: boolean;
    businessHours?: boolean;
    allowOrderCreation?: boolean;
    autoDetectProducts?: boolean;
    draftOrdersOnly?: boolean;
    requireManualConfirmation?: boolean;
  };
}

export default function ChatSettings() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // UI State
  const [expandedInfo, setExpandedInfo] = useState<string | null>(null);
  const [showManageModal, setShowManageModal] = useState(false);
  const [managedChannel, setManagedChannel] = useState<Channel | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<Channel | null>(null);
  const [showToast, setShowToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const { features: planFeatures } = useSubscriptionFeatures();

  const CHANNEL_SETTINGS_DEFAULTS = {
    aiAutoReply: true,
    requireApproval: false,
    businessHours: false,
    allowOrderCreation: true,
    autoDetectProducts: true,
    draftOrdersOnly: false,
    requireManualConfirmation: true,
  };
  const [channelSettings, setChannelSettings] = useState({ ...CHANNEL_SETTINGS_DEFAULTS });

  const statusConfig = {
    connected: { icon: CheckCircle, label: 'Connected', color: 'bg-green-100 text-green-800' },
    not_connected: { icon: Clock, label: 'Not Connected', color: 'bg-gray-100 text-gray-800' },
    connecting: { icon: Loader2, label: 'Connecting...', color: 'bg-blue-100 text-blue-800' },
  };

  const loadChannels = async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const backendChannels = await apiClient.getChannels();
      const mapped = backendChannels.map((channel: BackendChannel): Channel => {
        const descriptionMap: Record<string, string> = {
          facebook: 'Facebook Page এর জন্য — কাস্টমারের DM ও Order নিন',
          instagram: 'Instagram Shop এর জন্য — DM থেকে Order নিন',
        };

        const status = channel.connected || channel.status === 'active'
          ? 'connected'
          : 'not_connected';

        const type = (channel.type || (channel as any).channel_type || 'facebook') as Channel['type'];
        const logo = type === 'instagram'
          ? <Instagram className="w-8 h-8 text-pink-600" />
          : <MessageSquare className="w-8 h-8 text-blue-600" />;

        return {
          id: channel.id,
          name: channel.name || type,
          type,
          logo,
          description: descriptionMap[type] || 'Customer messaging channel',
          status,
          connectedAccount: channel.name || undefined,
          lastSync: channel.lastSync || channel.last_sync || undefined,
          hasToken: channel.config?.hasToken ?? false,
          tokenExpiresAt: (channel as any).token_expires_at ?? null,
          businessManagerId: channel.config?.businessManagerId,
          savedSettings: channel.config?.settings || undefined,
        };
      });

      const defaults: Channel[] = [
        {
          id: 'facebook',
          name: 'Messenger',
          type: 'facebook',
          logo: <MessageSquare className="w-8 h-8 text-blue-600" />,
          description: 'Facebook Page এর জন্য — কাস্টমারের DM ও Order নিন',
          status: 'not_connected'
        },
        {
          id: 'instagram',
          name: 'Instagram',
          type: 'instagram',
          logo: <Instagram className="w-8 h-8 text-pink-600" />,
          description: 'Instagram Shop এর জন্য — DM থেকে Order নিন',
          status: 'not_connected'
        }
      ];

      const merged = mapped.filter(channel => ['facebook', 'instagram'].includes(channel.type));
      defaults.forEach((channel) => {
        if (!merged.find(existing => existing.type === channel.type)) {
          merged.push(channel);
        }
      });

      setChannels(merged);
    } catch (err) {
      console.error('Failed to load channels:', err);
      setLoadError('Failed to load channels from backend');
      setShowToast({ type: 'error', message: 'Failed to load channels from backend' });
      setChannels([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadChannels();
  }, []);

  const handleDisconnect = async (channel: Channel) => {
    if (channel.id === channel.type) {
      setShowToast({ type: 'error', message: 'This channel is not connected yet.' });
      return;
    }
    try {
      await apiClient.disconnectChannel(channel.id);
      await loadChannels();
      setShowToast({ type: 'success', message: `${channel.name} disconnected successfully.` });
    } catch (error: any) {
      setShowToast({
        type: 'error',
        message: error.response?.data?.error?.message || 'Disconnect failed.'
      });
    }
  };

  const handleManageChannel = (channel: Channel) => {
    const saved = channel.savedSettings || {} as any;
    setChannelSettings({ ...CHANNEL_SETTINGS_DEFAULTS, ...saved });
    setManagedChannel({
      ...channel,
      connectedAccount: channel.connectedAccount || '',
      lastSync: channel.lastSync || '',
      businessManagerId: channel.businessManagerId || '',
    });
    setShowManageModal(true);
  };

  const handleSettingsChange = (key: keyof typeof channelSettings) => {
    setChannelSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  useEffect(() => {
    if (!showToast) return;
    const t = setTimeout(() => setShowToast(null), 4000);
    return () => clearTimeout(t);
  }, [showToast]);

  const dismissToast = () => setShowToast(null);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center space-x-3 mb-8">
        <div className="p-3 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg">
          <MessageSquare className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900">চ্যানেল সেটিংস</h2>
          <p className="text-gray-600 text-sm">আপনার চ্যানেলের সেটিংস পরিচালনা করুন</p>
        </div>
      </div>

      {/* Channels Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading && (
          <div className="col-span-full text-center text-gray-500 py-8">Loading channels...</div>
        )}
        {loadError && (
          <div className="col-span-full text-center text-red-600 py-8">{loadError}</div>
        )}
        {!isLoading && !loadError && channels.length === 0 && (
          <div className="col-span-full text-center text-gray-500 py-8">No channels found.</div>
        )}
        {!isLoading && !loadError && channels.map((channel) => {
          const status = statusConfig[channel.status];
          const StatusIcon = status.icon;

          return (
            <div key={channel.id} className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow p-5">
              {/* Channel Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-3">
                  {channel.logo}
                  <h3 className="font-semibold text-gray-900">{channel.name}</h3>
                </div>
              </div>

              {/* Status Badge */}
              <div className={`inline-flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-medium mb-3 ${status.color}`}>
                {status.icon === Loader2 ? (
                  <StatusIcon className="w-3 h-3 animate-spin" />
                ) : (
                  <StatusIcon className="w-3 h-3" />
                )}
                <span>{status.label}</span>
              </div>

              {/* Description */}
              <p className="text-sm text-gray-600 mb-4">{channel.description}</p>

              {/* Connected Info */}
              {channel.status === 'connected' && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm">
                  <div className="font-medium text-green-900">{channel.connectedAccount}</div>
                  {channel.lastSync && (
                    <div className="text-green-700 text-xs">Last sync: {formatDate(channel.lastSync)}</div>
                  )}
                </div>
              )}

              {/* Connection expiry warning */}
              {channel.status === 'connected' && channel.tokenExpiresAt && (() => {
                const expiresMs = new Date(channel.tokenExpiresAt).getTime() - Date.now();
                const dayMs = 86_400_000;
                if (expiresMs > 14 * dayMs) return null;
                const label = expiresMs < 0
                  ? 'সংযোগের মেয়াদ শেষ হয়েছে। আবার সংযুক্ত করুন।'
                  : `সংযোগের মেয়াদ ${Math.ceil(expiresMs / dayMs)} দিনের মধ্যে শেষ। পুনরায় সংযুক্ত করুন।`;
                return (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-lg p-2 mb-4 text-xs text-amber-800">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{label}</span>
                  </div>
                );
              })()}

              {/* Not connected — redirect to Channels page */}
              {channel.status === 'not_connected' && (
                <div className="mt-1 mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-center">
                  <p className="text-sm text-gray-600 mb-2">এই চ্যানেল সংযুক্ত করতে</p>
                  <Link
                    to="/app/channels"
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    চ্যানেল সংযুক্ত করুন
                  </Link>
                </div>
              )}

              {/* Automated Features (Collapsible) */}
              <details className="mb-4">
                <summary className="text-sm font-medium text-gray-700 cursor-pointer hover:text-gray-900 flex items-center">
                  <ChevronDown className="w-4 h-4 mr-2" />
                  Automated Features
                </summary>
                <div className="mt-3 text-xs text-gray-600 space-y-2 ml-6">
                  {channel.status === 'connected' ? (
                    <>
                      <div className="flex items-center space-x-2">
                        <CheckCircle className="w-3 h-3 text-green-600" />
                        <span>Auto-reply enabled</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <CheckCircle className="w-3 h-3 text-green-600" />
                        <span>Order creation enabled</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <CheckCircle className="w-3 h-3 text-green-600" />
                        <span>Payment tracking enabled</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-gray-500">Connect channel to enable features</p>
                  )}
                </div>
              </details>

              {/* Actions */}
              <div className="flex gap-2">
                {channel.status === 'connected' && (
                  <>
                    <button
                      onClick={() => handleManageChannel(channel)}
                      className="flex-1 bg-gray-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
                    >
                      Manage
                    </button>
                    <button
                      onClick={() => setConfirmDisconnect(channel)}
                      className="flex-1 bg-red-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
                    >
                      Disconnect
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Manage Channel Modal */}
      {showManageModal && managedChannel && (
        <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b">
              <h3 className="font-semibold text-gray-900">Manage {managedChannel.name}</h3>
              <button
                onClick={() => setShowManageModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6">
              {/* Connection Info */}
              <div>
                <h4 className="font-medium text-gray-900 mb-3">Connection Info</h4>
                <div className="bg-gray-50 rounded-lg p-3 space-y-2 text-sm">
                  <div>
                    <span className="text-gray-600">Account:</span>
                    <p className="font-medium text-gray-900">{managedChannel.connectedAccount}</p>
                  </div>
                  <div>
                    <span className="text-gray-600">Last Sync:</span>
                    <p className="font-medium text-gray-900">{formatDate(managedChannel.lastSync)}</p>
                  </div>
                  <div>
                    <span className="text-gray-600">সংযোগ:</span>
                    <div className="flex items-center gap-2 mt-1">
                      {managedChannel.hasToken ? (
                        <>
                          <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                          <span className="text-xs text-green-700 font-medium">সংযোগ সক্রিয় ও সুরক্ষিত</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                          <span className="text-xs text-amber-700">সংযোগ নেই — আবার সংযুক্ত করুন</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Message Handling */}
              <div>
                <h4 className="font-medium text-gray-900 mb-3">Message Handling</h4>
                <div className="space-y-3">
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={channelSettings.aiAutoReply}
                      onChange={() => handleSettingsChange('aiAutoReply')}
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-gray-700">AI Auto-Reply</span>
                  </label>
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={channelSettings.requireApproval}
                      onChange={() => handleSettingsChange('requireApproval')}
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-gray-700">Require Manual Approval</span>
                  </label>
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={channelSettings.businessHours}
                      onChange={() => handleSettingsChange('businessHours')}
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-gray-700">Business Hours Only</span>
                  </label>
                </div>
              </div>

              {/* Order Control */}
              <div>
                <h4 className="font-medium text-gray-900 mb-3">Order Control</h4>
                <div className="space-y-3">
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={channelSettings.allowOrderCreation}
                      onChange={() => handleSettingsChange('allowOrderCreation')}
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-gray-700">Allow Order Creation</span>
                  </label>
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={channelSettings.autoDetectProducts}
                      onChange={() => handleSettingsChange('autoDetectProducts')}
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-gray-700">Auto-Detect Products</span>
                  </label>
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={channelSettings.draftOrdersOnly}
                      onChange={() => handleSettingsChange('draftOrdersOnly')}
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-gray-700">Draft Orders Only</span>
                  </label>
                </div>
              </div>

              {/* Permissions & Safety */}
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-start space-x-2">
                  <Shield className="w-4 h-4 text-blue-600 mt-0.5" />
                  <div className="text-xs text-gray-600">
                    <p className="font-medium text-gray-900">Permissions Granted:</p>
                    <ul className="mt-1 space-y-1 list-disc list-inside">
                      <li>Read messages</li>
                      <li>Send messages</li>
                      <li>Read receipts</li>
                      <li>Manage labels</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-2 p-6 border-t bg-gray-50">
              <button
                onClick={() => setShowManageModal(false)}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Close
              </button>
              <button
                onClick={async () => {
                  if (!managedChannel) return;
                  try {
                    await apiClient.updateChannel(managedChannel.id, {
                      config: {
                        settings: channelSettings,
                      }
                    } as any);
                    setShowManageModal(false);
                    setShowToast({ type: 'success', message: 'Settings saved successfully!' });
                    loadChannels();
                  } catch (error: any) {
                    setShowToast({
                      type: 'error',
                      message: error.response?.data?.error?.message || 'Failed to save settings'
                    });
                  }
                }}
                className="px-4 py-2 text-white bg-blue-600 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Model Configuration */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-purple-100 rounded-lg">
            <Cpu className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">AI Model Configuration</h3>
            <p className="text-sm text-gray-500">Choose the language model used for AI auto-replies and suggestions</p>
          </div>
        </div>
        {!planFeatures.advanced_ai ? (
          <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <Lock className="w-5 h-5 text-gray-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-gray-700">Available on PACKAGE_2 and PARTNER plans</p>
              <p className="text-xs text-gray-500 mt-0.5">
                <a href="/subscription" className="text-purple-600 hover:underline">Upgrade your plan</a> to unlock AI model selection and advanced AI features.
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-blue-200 rounded-lg p-6 bg-blue-50">
            <div className="space-y-4">
              <div className="bg-white border border-blue-300 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Cpu className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">AI Model: Auto-Selected Based on Your Plan</p>
                    <p className="text-xs text-gray-600 mt-1">
                      EasyMod automatically selects the best AI model for your subscription tier. No configuration needed.
                    </p>
                  </div>
                </div>
              </div>
              <div className="text-xs text-gray-600 space-y-2">
                <p className="font-medium text-gray-700">Model Selection Strategy:</p>
                <ul className="space-y-1 ml-3 list-disc list-inside">
                  <li><span className="font-medium">PACKAGE_1:</span> Fast & cost-effective (GPT-4o-mini)</li>
                  <li><span className="font-medium">PACKAGE_2:</span> Balanced speed & intelligence (mix of models)</li>
                  <li><span className="font-medium">PARTNER:</span> Advanced reasoning & efficiency (Claude with caching)</li>
                </ul>
                <p className="mt-3 text-blue-700 font-medium">✓ This optimization reduces costs while improving response quality</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Disconnect Confirmation Dialog */}
      {confirmDisconnect && (
        <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6 space-y-4">
            <h3 className="font-semibold text-gray-900 text-lg">Disconnect {confirmDisconnect.name}?</h3>
            <p className="text-sm text-gray-600">
              This will stop all incoming messages and AI replies on this channel. You can reconnect at any time from the Channels page.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDisconnect(null)}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const ch = confirmDisconnect;
                  setConfirmDisconnect(null);
                  await handleDisconnect(ch);
                }}
                className="px-4 py-2 text-white bg-red-600 rounded-lg text-sm font-medium hover:bg-red-700"
              >
                Yes, Disconnect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {showToast && (
        <div className={`fixed bottom-4 right-4 z-50 flex items-center space-x-3 px-4 py-3 rounded-lg shadow-lg border ${
          showToast.type === 'success'
            ? 'bg-green-50 border-green-200'
            : 'bg-red-50 border-red-200'
        }`}>
          {showToast.type === 'success' ? (
            <CheckCircle className="w-5 h-5 text-green-600" />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-600" />
          )}
          <span className={`text-sm font-medium ${
            showToast.type === 'success' ? 'text-green-800' : 'text-red-800'
          }`}>
            {showToast.message}
          </span>
          <button
            onClick={dismissToast}
            className={`ml-4 ${showToast.type === 'success' ? 'text-green-600 hover:text-green-700' : 'text-red-600 hover:text-red-700'}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
