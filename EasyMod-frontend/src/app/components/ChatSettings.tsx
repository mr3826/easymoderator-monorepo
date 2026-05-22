import { useEffect, useRef, useState } from "react";
import {
  MessageSquare,
  Instagram,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Shield,
  Cpu,
  Lock,
  FlaskConical,
  Unplug,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  listMetaChannels,
  initiateMetaOAuth,
  handleMetaOAuthCallback,
  connectMetaAsset,
  pingMetaChannel,
  disconnectMetaChannel,
  getMetaChannelConsentSummary,
  type MetaChannel,
  type MetaPlatform,
  type MetaOAuthAsset,
  type MetaChannelConsentSummary,
  type MetaConsentEventType,
} from "@/api/domains/meta-channels";
import { useSubscriptionFeatures } from "../lib/useSubscriptionFeatures";
import { getMetaErrorMessage } from "@/lib/meta/error-messages";

const PLATFORMS: Array<{
  id: MetaPlatform;
  name: string;
  brandColor: string;
  bgColor: string;
  description: string;
}> = [
  {
    id: "facebook",
    name: "Facebook Messenger",
    brandColor: "#1877F2",
    bgColor: "bg-blue-50",
    description: "Facebook Page এর জন্য — কাস্টমারের DM ও Order নিন",
  },
  {
    id: "instagram",
    name: "Instagram DM",
    brandColor: "#E1306C",
    bgColor: "bg-pink-50",
    description: "Instagram Shop এর জন্য — DM থেকে Order নিন",
  },
];

const OAUTH_NONCE_KEY = "easymod_oauth_nonce";

function PlatformIcon({ id, color, size = 22 }: { id: MetaPlatform; color: string; size?: number }) {
  return id === "instagram" ? (
    <Instagram style={{ color, width: size, height: size }} />
  ) : (
    <MessageSquare style={{ color, width: size, height: size }} />
  );
}

export default function ChatSettings() {
  const { t } = useTranslation();
  const { features: planFeatures } = useSubscriptionFeatures();

  const [channels, setChannels] = useState<MetaChannel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeOAuth, setActiveOAuth] = useState<{
    platform: MetaPlatform;
    step: "connecting" | "page-select";
  } | null>(null);
  const [availablePages, setAvailablePages] = useState<MetaOAuthAsset[]>([]);
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set());
  const [tempToken, setTempToken] = useState("");
  const [isConnectingPage, setIsConnectingPage] = useState(false);
  const oauthPopupRef = useRef<Window | null>(null);
  const oauthListenerRef = useRef<((e: MessageEvent) => void) | null>(null);
  const oauthInProgressRef = useRef(false);

  const [testingId, setTestingId] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<MetaChannel | null>(null);
  const [consentByChannelId, setConsentByChannelId] = useState<Record<string, MetaChannelConsentSummary>>({});
  const [expandedConsentChannelId, setExpandedConsentChannelId] = useState<string | null>(null);
  const [loadingConsentId, setLoadingConsentId] = useState<string | null>(null);
  const [expandedPermissions, setExpandedPermissions] = useState<MetaPlatform | null>(null);

  const fetchChannels = async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const fetched = await listMetaChannels();
      setChannels(fetched.filter((c) => c.platform === "facebook" || c.platform === "instagram"));
    } catch (error: any) {
      const code = error.response?.data?.error?.code;
      const rawMsg = error.response?.data?.error?.message || "";
      setLoadError(getMetaErrorMessage(code, rawMsg, "en"));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const oauthError = sessionStorage.getItem("oauth_error");
    if (oauthError) {
      sessionStorage.removeItem("oauth_error");
      toast.error(oauthError);
    }
    fetchChannels();
    return () => {
      if (oauthListenerRef.current) {
        window.removeEventListener("message", oauthListenerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (activeOAuth?.step !== "connecting") return;
    const interval = setInterval(() => {
      if (oauthPopupRef.current?.closed) {
        clearInterval(interval);
        if (oauthListenerRef.current) {
          window.removeEventListener("message", oauthListenerRef.current);
          oauthListenerRef.current = null;
        }
        setActiveOAuth(null);
        oauthInProgressRef.current = false;
      }
    }, 500);
    return () => clearInterval(interval);
  }, [activeOAuth?.step]);

  const handleConnectClick = async (platform: MetaPlatform) => {
    if (oauthInProgressRef.current) {
      toast.error("একটি সংযোগ ইতিমধ্যে চলছে। আগের সংযোগ শেষ করুন।");
      return;
    }
    oauthInProgressRef.current = true;
    try {
      const { redirectUrl } = await initiateMetaOAuth(platform);

      try {
        const urlState = new URL(redirectUrl).searchParams.get("state");
        if (urlState) {
          sessionStorage.setItem(OAUTH_NONCE_KEY, urlState);
        }
      } catch {
        /* non-critical */
      }
      sessionStorage.setItem("easymod_oauth_channel_type", platform);

      oauthPopupRef.current = window.open(
        redirectUrl,
        "meta_oauth",
        "width=600,height=700,left=200,top=100",
      );
      setActiveOAuth({ platform, step: "connecting" });

      const handler = (e: MessageEvent) => {
        if (e.origin !== window.location.origin) return;
        if (oauthPopupRef.current && e.source !== oauthPopupRef.current) return;

        if (e.data?.type === "OAUTH_SUCCESS") {
          const expectedNonce = sessionStorage.getItem(OAUTH_NONCE_KEY);
          sessionStorage.removeItem(OAUTH_NONCE_KEY);
          if (expectedNonce && e.data.state !== expectedNonce) {
            toast.error(t("channels.errors.oauthStateMismatch", "OAuth validation failed — please try again"));
            setActiveOAuth(null);
            oauthInProgressRef.current = false;
            window.removeEventListener("message", handler);
            oauthListenerRef.current = null;
            return;
          }

          handleMetaOAuthCallback(e.data.code, e.data.state)
            .then((result) => {
              setAvailablePages(result.pages);
              setSelectedPageIds(new Set());
              setTempToken(result.tempToken);
              setActiveOAuth({ platform, step: "page-select" });
            })
            .catch(() => {
              toast.error(t("channels.errors.connectionFailed", "সংযোগ ব্যর্থ — আবার চেষ্টা করুন"));
              setActiveOAuth(null);
            });
        } else if (e.data?.type === "OAUTH_ERROR") {
          sessionStorage.removeItem(OAUTH_NONCE_KEY);
          toast.error(e.data.error || t("channels.errors.connectionFailed", "সংযোগ ব্যর্থ"));
          setActiveOAuth(null);
        }
        window.removeEventListener("message", handler);
        oauthListenerRef.current = null;
        oauthInProgressRef.current = false;
      };
      oauthListenerRef.current = handler;
      window.addEventListener("message", handler);
    } catch {
      sessionStorage.removeItem(OAUTH_NONCE_KEY);
      oauthInProgressRef.current = false;
      toast.error(t("channels.errors.oauthInitFailed", "সংযোগ শুরু করা যায়নি"));
    }
  };

  const handleCancelOAuth = () => {
    oauthPopupRef.current?.close();
    oauthInProgressRef.current = false;
    if (oauthListenerRef.current) {
      window.removeEventListener("message", oauthListenerRef.current);
      oauthListenerRef.current = null;
    }
    sessionStorage.removeItem(OAUTH_NONCE_KEY);
    setActiveOAuth(null);
    setAvailablePages([]);
    setSelectedPageIds(new Set());
    setTempToken("");
  };

  const togglePageSelection = (pageId: string) => {
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  };

  const handleConnectPages = async () => {
    if (!activeOAuth || selectedPageIds.size === 0) return;
    setIsConnectingPage(true);
    try {
      let webhookWarning: string | null = null;
      for (const page of availablePages.filter((p) => selectedPageIds.has(p.id))) {
        const result = await connectMetaAsset({
          assetId: page.id,
          displayName: page.name,
          tempToken,
          platform: activeOAuth.platform,
        });
        if (result.webhookWarning) webhookWarning = result.webhookWarning;
      }
      await fetchChannels();
      setActiveOAuth(null);
      setAvailablePages([]);
      setSelectedPageIds(new Set());
      setTempToken("");
      toast.success("সফলভাবে সংযুক্ত হয়েছে।");
      if (webhookWarning) {
        setTimeout(() => toast.warning(webhookWarning!, { duration: 12000 }), 500);
      }
    } catch {
      toast.error(t("channels.errors.connectionFailed", "সংযোগ ব্যর্থ"));
    } finally {
      setIsConnectingPage(false);
    }
  };

  const handleTestPipeline = async (channelId: string) => {
    setTestingId(channelId);
    try {
      const result = await pingMetaChannel(channelId);
      if (result.ping.ok) {
        toast.success(`Webhook OK (${result.ping.latencyMs ?? "?"}ms)`, { duration: 8000 });
      } else {
        toast.error(`Webhook failed: ${result.ping.error}`, { duration: 15000 });
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? "Test failed — check backend logs");
    } finally {
      setTestingId(null);
    }
  };

  const handleDisconnect = async (channel: MetaChannel) => {
    setDisconnectingId(channel.id);
    try {
      await disconnectMetaChannel(channel.id);
      toast.success(`${channel.displayName} disconnected`);
      await fetchChannels();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to disconnect");
    } finally {
      setDisconnectingId(null);
      setConfirmDisconnect(null);
    }
  };

  const handleToggleConsent = async (channelId: string) => {
    if (expandedConsentChannelId === channelId) {
      setExpandedConsentChannelId(null);
      return;
    }
    setExpandedConsentChannelId(channelId);
    if (consentByChannelId[channelId]) return;
    setLoadingConsentId(channelId);
    try {
      const summary = await getMetaChannelConsentSummary(channelId);
      setConsentByChannelId((prev) => ({ ...prev, [channelId]: summary }));
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || "Could not load consent activity");
      setExpandedConsentChannelId(null);
    } finally {
      setLoadingConsentId(null);
    }
  };

  const consentEventLabel = (event: MetaConsentEventType): string =>
    ({
      OPT_IN_IMPLICIT: "Opted in (implicit)",
      OPT_IN_EXPLICIT: "Opted in",
      OPT_OUT: "Opted out",
      DEAUTHORIZED: "Deauthorized",
      DATA_DELETED: "Data deleted",
    }[event] || event);

  const consentEventBadgeClass = (event: MetaConsentEventType): string =>
    event === "OPT_OUT" || event === "DEAUTHORIZED" || event === "DATA_DELETED"
      ? "bg-red-50 text-red-700"
      : "bg-green-50 text-green-700";

  const cardsByPlatform = PLATFORMS.map((platform) => ({
    platform,
    channel: channels.find((c) => c.platform === platform.id),
  }));

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg">
          <MessageSquare className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-gray-900">চ্যানেল সেটিংস</h2>
          <p className="text-sm text-gray-500">Facebook ও Instagram চ্যানেল সংযুক্ত ও পরিচালনা করুন</p>
        </div>
      </div>

      {isLoading && (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-5 animate-pulse">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-11 h-11 rounded-full bg-gray-200" />
                <div className="flex-1">
                  <div className="h-4 w-32 bg-gray-200 rounded mb-2" />
                  <div className="h-3 w-20 bg-gray-200 rounded" />
                </div>
              </div>
              <div className="h-3 w-full bg-gray-100 rounded mb-2" />
              <div className="h-9 w-full bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      )}

      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700 flex-1">{loadError}</p>
          <button onClick={fetchChannels} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm">
            Retry
          </button>
        </div>
      )}

      {!isLoading && !loadError && (
        <div className="grid gap-4 md:grid-cols-2">
          {cardsByPlatform.map(({ platform, channel }) => {
            const isConnected = channel?.status === "CONNECTED";
            const isTokenExpired = channel?.status === "TOKEN_EXPIRED" || channel?.status === "REVOKED";
            const isErrored = channel?.status === "ERROR";
            const isThisCardOAuth = activeOAuth?.platform === platform.id;
            const isPermissionsExpanded = expandedPermissions === platform.id;
            const isConsentExpanded = !!channel && expandedConsentChannelId === channel.id;
            const consentSummary = channel ? consentByChannelId[channel.id] : undefined;
            const isConsentLoading = !!channel && loadingConsentId === channel.id;

            return (
              <div
                key={platform.id}
                className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow p-5"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-11 h-11 rounded-full ${platform.bgColor} flex items-center justify-center`}>
                      <PlatformIcon id={platform.id} color={platform.brandColor} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{platform.name}</h3>
                      {isConnected && channel ? (
                        <p className="text-sm text-gray-500 truncate max-w-[180px]">{channel.displayName}</p>
                      ) : (
                        <p className="text-xs text-gray-400">Not connected</p>
                      )}
                    </div>
                  </div>
                  {isConnected && (
                    <span className="flex items-center gap-1 px-2.5 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                      <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                      Active
                    </span>
                  )}
                  {isTokenExpired && (
                    <span className="flex items-center gap-1 px-2.5 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">
                      <AlertCircle className="w-3 h-3" />
                      Reconnect
                    </span>
                  )}
                  {isErrored && (
                    <span className="flex items-center gap-1 px-2.5 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                      <AlertCircle className="w-3 h-3" />
                      Error
                    </span>
                  )}
                </div>

                <p className="text-sm text-gray-600 mb-4">{platform.description}</p>

                {isConnected &&
                  channel?.tokenExpiresAt &&
                  (() => {
                    const expiresMs = new Date(channel.tokenExpiresAt).getTime() - Date.now();
                    const dayMs = 86_400_000;
                    if (expiresMs > 14 * dayMs) return null;
                    const label =
                      expiresMs < 0
                        ? "সংযোগের মেয়াদ শেষ। আবার সংযুক্ত করুন।"
                        : `সংযোগের মেয়াদ ${Math.ceil(expiresMs / dayMs)} দিনের মধ্যে শেষ।`;
                    return (
                      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-4 text-xs text-amber-800">
                        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>{label}</span>
                      </div>
                    );
                  })()}

                {isThisCardOAuth && activeOAuth.step === "connecting" && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-center">
                    <Loader2
                      className="w-8 h-8 animate-spin mx-auto mb-2"
                      style={{ color: platform.brandColor }}
                    />
                    <p className="text-sm font-medium text-gray-800">{platform.name} এর অনুমতি দিন</p>
                    <p className="text-xs text-gray-500 mt-1">পপ-আপ উইন্ডোতে লগইন করুন...</p>
                    <button
                      onClick={handleCancelOAuth}
                      className="mt-3 text-xs text-gray-500 hover:text-gray-700 underline"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {isThisCardOAuth && activeOAuth.step === "page-select" && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <h4 className="font-semibold text-gray-900 text-sm mb-1">Page নির্বাচন করুন</h4>
                    <p className="text-xs text-gray-600 mb-3">
                      যে Page-গুলো সংযুক্ত করতে চান, সেগুলো নির্বাচন করুন
                    </p>
                    {availablePages.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-4">
                        {platform.id === "instagram"
                          ? "কোনো Instagram Business অ্যাকাউন্ট পাওয়া যায়নি।"
                          : "আপনি manage করেন এমন কোনো Page পাওয়া যায়নি।"}
                      </p>
                    ) : (
                      <div className="space-y-2 max-h-56 overflow-y-auto">
                        {availablePages.map((page) => (
                          <label
                            key={page.id}
                            className={`flex items-center gap-3 p-2.5 rounded-lg border-2 cursor-pointer transition-colors ${
                              selectedPageIds.has(page.id)
                                ? "border-blue-500 bg-white"
                                : "border-gray-200 bg-white hover:bg-gray-50"
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="w-4 h-4 accent-blue-600"
                              checked={selectedPageIds.has(page.id)}
                              onChange={() => togglePageSelection(page.id)}
                            />
                            {page.pictureUrl ? (
                              <img
                                src={page.pictureUrl}
                                alt={page.name}
                                className="w-8 h-8 rounded-full object-cover"
                              />
                            ) : (
                              <div
                                className={`w-8 h-8 rounded-full ${platform.bgColor} flex items-center justify-center`}
                              >
                                <PlatformIcon id={platform.id} color={platform.brandColor} size={14} />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-gray-900 text-sm truncate">{page.name}</p>
                              {page.instagramAccount && (
                                <p className="text-xs text-pink-600">@{page.instagramAccount.username}</p>
                              )}
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={handleCancelOAuth}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-xs text-gray-700 hover:bg-white"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleConnectPages}
                        disabled={selectedPageIds.size === 0 || isConnectingPage}
                        className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        {isConnectingPage && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Connect ({selectedPageIds.size})
                      </button>
                    </div>
                  </div>
                )}

                {!isConnected && !isThisCardOAuth && (
                  <div className="space-y-3">
                    <button
                      onClick={() => handleConnectClick(platform.id)}
                      style={{ backgroundColor: platform.brandColor }}
                      className="w-full py-2.5 text-white rounded-lg font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
                    >
                      <PlatformIcon id={platform.id} color="white" size={18} />
                      {isTokenExpired
                        ? `${platform.name} আবার সংযুক্ত করুন`
                        : `${platform.name} সংযুক্ত করুন`}
                    </button>

                    <button
                      onClick={() => setExpandedPermissions(isPermissionsExpanded ? null : platform.id)}
                      className="w-full text-xs text-gray-500 hover:text-gray-700 flex items-center justify-center gap-1"
                    >
                      <Shield className="w-3.5 h-3.5" />
                      {isPermissionsExpanded ? "অনুমতি লুকান" : "কোন অনুমতি লাগবে?"}
                      {isPermissionsExpanded ? (
                        <ChevronUp className="w-3 h-3" />
                      ) : (
                        <ChevronDown className="w-3 h-3" />
                      )}
                    </button>

                    {isPermissionsExpanded && (
                      <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-xs text-gray-700">
                        <ul className="space-y-1 list-disc list-inside">
                          {platform.id === "facebook" && (
                            <>
                              <li>
                                <strong>pages_show_list</strong> — আপনার Page list দেখা
                              </li>
                              <li>
                                <strong>pages_messaging</strong> — Messenger বার্তা পড়া ও পাঠানো
                              </li>
                              <li>
                                <strong>pages_read_engagement</strong> — Page conversation পড়া
                              </li>
                              <li>
                                <strong>pages_manage_metadata</strong> — Realtime webhook subscribe
                              </li>
                            </>
                          )}
                          {platform.id === "instagram" && (
                            <>
                              <li>
                                <strong>instagram_basic</strong> — IG Business অ্যাকাউন্ট অ্যাক্সেস
                              </li>
                              <li>
                                <strong>instagram_manage_messages</strong> — IG DM পড়া ও পাঠানো
                              </li>
                              <li>
                                <strong>pages_show_list</strong> — IG-linked Page চিহ্নিত করা
                              </li>
                              <li>
                                <strong>pages_read_engagement</strong> — Delivery receipts
                              </li>
                              <li>
                                <strong>pages_manage_metadata</strong> — Realtime DM webhook
                              </li>
                            </>
                          )}
                        </ul>
                        <p className="mt-2 text-gray-500 text-[11px]">
                          EasyMod শুধু কাস্টমার বার্তার জন্য এই অনুমতি ব্যবহার করে।
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {isConnected && channel && (
                  <>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <button
                        onClick={() => handleTestPipeline(channel.id)}
                        disabled={testingId === channel.id}
                        title="Webhook test"
                        className="flex items-center justify-center gap-1 px-2 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-xs hover:bg-gray-50 disabled:opacity-60"
                      >
                        {testingId === channel.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <FlaskConical className="w-3.5 h-3.5" />
                        )}
                        Test
                      </button>
                      <button
                        onClick={fetchChannels}
                        title="Refresh"
                        className="flex items-center justify-center gap-1 px-2 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-xs hover:bg-gray-50"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Refresh
                      </button>
                      <button
                        onClick={() => setConfirmDisconnect(channel)}
                        disabled={disconnectingId === channel.id}
                        className="flex items-center justify-center gap-1 px-2 py-1.5 border border-red-200 text-red-600 rounded-lg text-xs hover:bg-red-50 disabled:opacity-60"
                      >
                        {disconnectingId === channel.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Unplug className="w-3.5 h-3.5" />
                        )}
                        Disconnect
                      </button>
                    </div>

                    <Collapsible.Root
                      open={isConsentExpanded}
                      onOpenChange={(open) => {
                        if (open) handleToggleConsent(channel.id);
                        else setExpandedConsentChannelId(null);
                      }}
                      className="pt-3 border-t border-gray-100"
                    >
                      <Collapsible.Trigger asChild>
                        <button className="w-full flex items-center justify-between text-xs text-gray-700 hover:text-gray-900">
                          <span className="flex items-center gap-1.5">
                            <ShieldCheck className="w-3.5 h-3.5 text-gray-500" />
                            <span className="font-medium">Consent activity</span>
                            {consentSummary && (
                              <span className="ml-1 text-gray-500">
                                ({consentSummary.counts.optIns} opt-ins)
                              </span>
                            )}
                          </span>
                          {isConsentLoading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
                          ) : isConsentExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                          )}
                        </button>
                      </Collapsible.Trigger>
                      <Collapsible.Content>
                        <AnimatePresence>
                          {isConsentExpanded && consentSummary && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="mt-3 space-y-2">
                                <div className="grid grid-cols-4 gap-1.5 text-center">
                                  <div className="rounded bg-green-50 px-1.5 py-1.5">
                                    <p className="text-sm font-semibold text-green-700">
                                      {consentSummary.counts.optIns}
                                    </p>
                                    <p className="text-[9px] uppercase text-green-700/80">Opt-ins</p>
                                  </div>
                                  <div className="rounded bg-red-50 px-1.5 py-1.5">
                                    <p className="text-sm font-semibold text-red-700">
                                      {consentSummary.counts.optOuts}
                                    </p>
                                    <p className="text-[9px] uppercase text-red-700/80">Opt-outs</p>
                                  </div>
                                  <div className="rounded bg-gray-100 px-1.5 py-1.5">
                                    <p className="text-sm font-semibold text-gray-600">
                                      {consentSummary.counts.deauthorized}
                                    </p>
                                    <p className="text-[9px] uppercase text-gray-500">Deauth</p>
                                  </div>
                                  <div className="rounded bg-gray-100 px-1.5 py-1.5">
                                    <p className="text-sm font-semibold text-gray-600">
                                      {consentSummary.counts.dataDeleted}
                                    </p>
                                    <p className="text-[9px] uppercase text-gray-500">Erased</p>
                                  </div>
                                </div>
                                {consentSummary.recentEvents.length === 0 ? (
                                  <p className="text-xs text-gray-400 italic">
                                    No consent events recorded yet.
                                  </p>
                                ) : (
                                  <ul className="space-y-1 max-h-40 overflow-y-auto">
                                    {consentSummary.recentEvents.map((ev) => (
                                      <li
                                        key={ev.id}
                                        className="flex items-center justify-between gap-1.5 text-xs"
                                      >
                                        <span
                                          className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${consentEventBadgeClass(
                                            ev.event,
                                          )}`}
                                        >
                                          {consentEventLabel(ev.event)}
                                        </span>
                                        <span className="text-gray-500 truncate flex-1">{ev.source}</span>
                                        <span className="text-gray-400 flex-shrink-0">
                                          {new Date(ev.createdAt).toLocaleDateString()}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </Collapsible.Content>
                    </Collapsible.Root>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-purple-100 rounded-lg">
            <Cpu className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">AI Model Configuration</h3>
            <p className="text-sm text-gray-500">AI auto-reply এর ভাষা মডেল</p>
          </div>
        </div>
        {!planFeatures.advanced_ai ? (
          <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <Lock className="w-5 h-5 text-gray-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-gray-700">
                PACKAGE_2 ও PARTNER প্ল্যানে available
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                <a href="/app/subscription" className="text-purple-600 hover:underline">
                  Plan upgrade করুন
                </a>{" "}
                AI model selection এর জন্য
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Cpu className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-900">
                  AI Model: Auto-Selected Based on Your Plan
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  আপনার subscription tier অনুযায়ী EasyMod সেরা মডেল বেছে নেয়।
                </p>
                <ul className="mt-2 text-xs text-gray-600 space-y-0.5 ml-3 list-disc list-inside">
                  <li>
                    <span className="font-medium">PACKAGE_1:</span> GPT-4o-mini (fast)
                  </li>
                  <li>
                    <span className="font-medium">PACKAGE_2:</span> Balanced mix
                  </li>
                  <li>
                    <span className="font-medium">PARTNER:</span> Claude with caching
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>

      {confirmDisconnect && (
        <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6 space-y-4">
            <h3 className="font-semibold text-gray-900 text-lg">
              Disconnect {confirmDisconnect.displayName}?
            </h3>
            <p className="text-sm text-gray-600">
              এই চ্যানেলে বার্তা পাওয়া বন্ধ হয়ে যাবে। পরে আবার সংযুক্ত করা যাবে।
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDisconnect(null)}
                className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDisconnect(confirmDisconnect)}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700"
              >
                Yes, Disconnect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
