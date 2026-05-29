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
  FlaskConical,
  Unplug,
  RefreshCw,
  ShieldCheck,
  Plus,
  Check,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  listMetaChannels,
  initiateMetaOAuth,
  handleMetaOAuthCallback,
  initiateMetaUnifiedOAuth,
  handleMetaUnifiedOAuthCallback,
  connectMetaAsset,
  pingMetaChannel,
  disconnectMetaChannel,
  getMetaChannelConsentSummary,
  updateMetaChannelPurposeLabel,
  getMetaChannelSettings,
  updateMetaChannelSettings,
  type MetaChannel,
  type MetaPlatform,
  type MetaOAuthAsset,
  type MetaChannelConsentSummary,
  type MetaConsentEventType,
  type MetaChannelSettings,
} from "@/api/domains/meta-channels";

// Picker entry covers both per-platform flow (no `platform`, falls back to
// activeOAuth.platform) and unified flow (each asset carries its own platform).
type PickerEntry = MetaOAuthAsset & { platform?: MetaPlatform };
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

  const [channels, setChannels] = useState<MetaChannel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeOAuth, setActiveOAuth] = useState<{
    platform: MetaPlatform | "unified";
    step: "connecting" | "page-select";
  } | null>(null);
  const [availablePages, setAvailablePages] = useState<PickerEntry[]>([]);
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
  const [savingLabelId, setSavingLabelId] = useState<string | null>(null);

  const handleSavePurposeLabel = async (
    channelId: string,
    rawLabel: string,
    currentLabel: string | null,
  ) => {
    const next = rawLabel.trim().slice(0, 64);
    const normalized = next.length === 0 ? null : next;
    if ((currentLabel ?? null) === normalized) return;

    try {
      setSavingLabelId(channelId);
      const updated = await updateMetaChannelPurposeLabel(channelId, normalized);
      setChannels((prev) => prev.map((c) => (c.id === channelId ? updated : c)));
      toast.success(normalized ? `Label updated to "${normalized}"` : "Label cleared");
    } catch (error: any) {
      const msg = error.response?.data?.error?.message || "Failed to update label";
      toast.error(msg);
    } finally {
      setSavingLabelId(null);
    }
  };

  const fetchChannels = async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const fetched = await listMetaChannels();
      setChannels(
        fetched.filter(
          (c) =>
            (c.platform === "facebook" || c.platform === "instagram") &&
            c.status !== "DISCONNECTED",
        ),
      );
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

      const bc = new BroadcastChannel("easymod_oauth");
      const cleanup = () => {
        window.removeEventListener("message", handler);
        bc.close();
        oauthListenerRef.current = null;
        oauthInProgressRef.current = false;
      };

      const processPayload = (data: any) => {
        if (data?.type === "OAUTH_SUCCESS") {
          const expectedNonce = sessionStorage.getItem(OAUTH_NONCE_KEY);
          sessionStorage.removeItem(OAUTH_NONCE_KEY);
          if (expectedNonce && data.state !== expectedNonce) {
            toast.error(t("channels.errors.oauthStateMismatch", "OAuth validation failed — please try again"));
            setActiveOAuth(null);
            cleanup();
            return;
          }

          handleMetaOAuthCallback(data.code, data.state)
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
        } else if (data?.type === "OAUTH_ERROR") {
          sessionStorage.removeItem(OAUTH_NONCE_KEY);
          toast.error(data.error || t("channels.errors.connectionFailed", "সংযোগ ব্যর্থ"));
          setActiveOAuth(null);
        }
        cleanup();
      };

      const handler = (e: MessageEvent) => {
        if (e.origin !== window.location.origin) return;
        if (oauthPopupRef.current && e.source !== oauthPopupRef.current) return;
        processPayload(e.data);
      };
      bc.onmessage = (e) => processPayload(e.data);
      oauthListenerRef.current = handler;
      window.addEventListener("message", handler);
    } catch {
      sessionStorage.removeItem(OAUTH_NONCE_KEY);
      oauthInProgressRef.current = false;
      toast.error(t("channels.errors.oauthInitFailed", "সংযোগ শুরু করা যায়নি"));
    }
  };

  // Unified FB+IG consent — one popup, picker lists assets from both platforms.
  // Each asset carries its own `platform` so connectMetaAsset routes correctly.
  const handleConnectUnified = async () => {
    if (oauthInProgressRef.current) {
      toast.error("একটি সংযোগ ইতিমধ্যে চলছে। আগের সংযোগ শেষ করুন।");
      return;
    }
    oauthInProgressRef.current = true;
    try {
      const { redirectUrl } = await initiateMetaUnifiedOAuth();

      try {
        const urlState = new URL(redirectUrl).searchParams.get("state");
        if (urlState) sessionStorage.setItem(OAUTH_NONCE_KEY, urlState);
      } catch { /* non-critical */ }
      sessionStorage.setItem("easymod_oauth_channel_type", "unified");

      oauthPopupRef.current = window.open(
        redirectUrl,
        "meta_oauth",
        "width=600,height=700,left=200,top=100",
      );
      setActiveOAuth({ platform: "unified", step: "connecting" });

      const bc = new BroadcastChannel("easymod_oauth");
      const cleanup = () => {
        window.removeEventListener("message", handler);
        bc.close();
        oauthListenerRef.current = null;
        oauthInProgressRef.current = false;
      };

      const processPayload = (data: any) => {
        if (data?.type === "OAUTH_SUCCESS") {
          const expectedNonce = sessionStorage.getItem(OAUTH_NONCE_KEY);
          sessionStorage.removeItem(OAUTH_NONCE_KEY);
          if (expectedNonce && data.state !== expectedNonce) {
            toast.error(t("channels.errors.oauthStateMismatch", "OAuth validation failed — please try again"));
            setActiveOAuth(null);
            cleanup();
            return;
          }

          handleMetaUnifiedOAuthCallback(data.code, data.state)
            .then((result) => {
              const fbEntries: PickerEntry[] = result.facebookPages.map((p) => ({
                id: p.id,
                name: p.name,
                category: p.category ?? null,
                pictureUrl: p.pictureUrl ?? null,
                instagramAccount: null,
                platform: "facebook",
              }));
              const igEntries: PickerEntry[] = result.instagramAccounts.map((a) => ({
                id: a.id,
                name: a.linkedPageName ? `${a.name} · IG of ${a.linkedPageName}` : a.name,
                category: null,
                pictureUrl: null,
                instagramAccount: null,
                platform: "instagram",
              }));
              setAvailablePages([...fbEntries, ...igEntries]);
              setSelectedPageIds(new Set());
              setTempToken(result.tempToken);
              setActiveOAuth({ platform: "unified", step: "page-select" });
            })
            .catch(() => {
              toast.error(t("channels.errors.connectionFailed", "সংযোগ ব্যর্থ — আবার চেষ্টা করুন"));
              setActiveOAuth(null);
            });
        } else if (data?.type === "OAUTH_ERROR") {
          sessionStorage.removeItem(OAUTH_NONCE_KEY);
          toast.error(data.error || t("channels.errors.connectionFailed", "সংযোগ ব্যর্থ"));
          setActiveOAuth(null);
        }
        cleanup();
      };

      const handler = (e: MessageEvent) => {
        if (e.origin !== window.location.origin) return;
        if (oauthPopupRef.current && e.source !== oauthPopupRef.current) return;
        processPayload(e.data);
      };
      bc.onmessage = (e) => processPayload(e.data);
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
        // Unified flow: each entry carries its own platform. Per-platform flow:
        // fall back to the active OAuth platform.
        const assetPlatform =
          page.platform ??
          (activeOAuth.platform === "unified" ? "facebook" : activeOAuth.platform);
        const result = await connectMetaAsset({
          assetId: page.id,
          displayName: page.name,
          tempToken,
          platform: assetPlatform,
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

  // Group connected channels by platform. Platforms with zero channels are
  // skipped — first-time and additional adds both go through the unified
  // "Connect Messenger + Instagram" button at the top of the page.
  type CardEntry = { channel: MetaChannel | null; isAddTile: boolean };
  const platformSections = PLATFORMS.map((platform) => {
    const platformChannels = channels.filter((c) => c.platform === platform.id);
    const cards: CardEntry[] = platformChannels.map((c) => ({ channel: c, isAddTile: false }));
    return { platform, platformChannels, cards };
  }).filter(({ cards }) => cards.length > 0);

  // Asset IDs already connected — used to disable those rows in the page
  // picker. Per-platform flow filters to the active platform; unified flow
  // considers all connected channels since both platforms can appear in the
  // picker.
  const alreadyConnectedAssetIds = new Set(
    activeOAuth
      ? (activeOAuth.platform === "unified"
          ? channels.map((c) => c.metaAssetId)
          : channels
              .filter((c) => c.platform === activeOAuth.platform)
              .map((c) => c.metaAssetId))
      : [],
  );

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

      {!isLoading && !loadError && activeOAuth?.platform === "unified" && (
        <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex -space-x-1">
              <div className="w-7 h-7 rounded-full bg-white border-2 border-blue-300 flex items-center justify-center">
                <MessageSquare className="w-3.5 h-3.5" style={{ color: "#1877F2" }} />
              </div>
              <div className="w-7 h-7 rounded-full bg-white border-2 border-blue-300 flex items-center justify-center">
                <Instagram className="w-3.5 h-3.5" style={{ color: "#E1306C" }} />
              </div>
            </div>
            <h3 className="font-semibold text-gray-900">Facebook + Instagram একসাথে সংযুক্ত করুন</h3>
          </div>

          {activeOAuth.step === "connecting" && (
            <div className="text-center py-4">
              <Loader2 className="w-7 h-7 animate-spin mx-auto mb-2 text-blue-600" />
              <p className="text-sm text-gray-700">পপ-আপে Meta-তে লগইন করুন...</p>
              <button
                onClick={handleCancelOAuth}
                className="mt-2 text-xs text-gray-600 hover:text-gray-800 underline"
              >
                Cancel
              </button>
            </div>
          )}

          {activeOAuth.step === "page-select" && (
            <div>
              <p className="text-xs text-gray-700 mb-3">
                আপনার Facebook Page এবং linked Instagram অ্যাকাউন্ট নির্বাচন করুন
              </p>
              {availablePages.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">
                  কোনো asset পাওয়া যায়নি।
                </p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {availablePages.map((page) => {
                    const isAlreadyConnected = alreadyConnectedAssetIds.has(page.id);
                    const itemPlatform: MetaPlatform = page.platform ?? "facebook";
                    const brand = itemPlatform === "instagram" ? "#E1306C" : "#1877F2";
                    const bg = itemPlatform === "instagram" ? "bg-pink-50" : "bg-blue-100";
                    return (
                      <label
                        key={`${itemPlatform}-${page.id}`}
                        className={`flex items-center gap-3 p-2.5 rounded-lg border-2 transition-colors ${
                          isAlreadyConnected
                            ? "border-gray-200 bg-gray-100 cursor-not-allowed opacity-70"
                            : selectedPageIds.has(page.id)
                            ? "border-blue-500 bg-white cursor-pointer"
                            : "border-gray-200 bg-white hover:bg-gray-50 cursor-pointer"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-blue-600"
                          checked={selectedPageIds.has(page.id)}
                          disabled={isAlreadyConnected}
                          onChange={() => togglePageSelection(page.id)}
                        />
                        <div className={`w-8 h-8 rounded-full ${bg} flex items-center justify-center`}>
                          <PlatformIcon id={itemPlatform} color={brand} size={14} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 text-sm truncate">{page.name}</p>
                          <p className="text-[10px] uppercase tracking-wide text-gray-500">
                            {itemPlatform === "instagram" ? "Instagram" : "Facebook Page"}
                          </p>
                        </div>
                        {isAlreadyConnected && (
                          <span className="flex items-center gap-1 text-[10px] font-medium text-green-700 bg-green-50 px-1.5 py-0.5 rounded-full flex-shrink-0">
                            <Check className="w-3 h-3" />
                            Connected
                          </span>
                        )}
                      </label>
                    );
                  })}
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
        </div>
      )}

      {!isLoading && !loadError && !activeOAuth && (
        <button
          onClick={handleConnectUnified}
          className="w-full rounded-xl border-2 border-blue-400 bg-gradient-to-r from-blue-50 to-pink-50 hover:from-blue-100 hover:to-pink-100 p-4 flex items-center justify-center gap-3 transition-colors"
        >
          <div className="flex -space-x-1">
            <div className="w-7 h-7 rounded-full bg-white border-2 border-blue-300 flex items-center justify-center">
              <MessageSquare className="w-3.5 h-3.5" style={{ color: "#1877F2" }} />
            </div>
            <div className="w-7 h-7 rounded-full bg-white border-2 border-pink-300 flex items-center justify-center">
              <Instagram className="w-3.5 h-3.5" style={{ color: "#E1306C" }} />
            </div>
          </div>
          <span className="font-semibold text-gray-900 text-sm">
            Facebook + Instagram একসাথে সংযুক্ত করুন (one popup)
          </span>
        </button>
      )}

      {!isLoading && !loadError && (
        <div className="space-y-8">
          {platformSections.map(({ platform, platformChannels, cards }) => (
            <section key={platform.id} className="space-y-3">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full ${platform.bgColor} flex items-center justify-center`}>
                  <PlatformIcon id={platform.id} color={platform.brandColor} size={18} />
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-gray-900">{platform.name}</h3>
                  <p className="text-xs text-gray-500">
                    {platformChannels.length === 0
                      ? "Not connected"
                      : `${platformChannels.length} connected`}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
          {cards.map((entry, cardIdx) => {
            const { channel, isAddTile } = entry;
            const isConnected = channel?.status === "CONNECTED";
            const isTokenExpired = channel?.status === "TOKEN_EXPIRED" || channel?.status === "REVOKED";
            const isErrored = channel?.status === "ERROR";
            // OAuth in-flight surfaces in the non-connected slot for the matching
            // platform — that's the add-tile (when channels exist) or the
            // first-time-connect card (when none do).
            const isThisCardOAuth =
              activeOAuth?.platform === platform.id && channel === null;
            const isPermissionsExpanded = expandedPermissions === platform.id;
            const isConsentExpanded = !!channel && expandedConsentChannelId === channel.id;
            const consentSummary = channel ? consentByChannelId[channel.id] : undefined;
            const isConsentLoading = !!channel && loadingConsentId === channel.id;
            const cardKey = channel?.id ?? `${platform.id}-${isAddTile ? "add" : "new"}-${cardIdx}`;

            return (
              <div
                key={cardKey}
                className={`bg-white border border-gray-200 rounded-xl shadow-sm transition-shadow p-5 ${
                  isAddTile && !isThisCardOAuth
                    ? "border-dashed hover:border-gray-400"
                    : "hover:shadow-md"
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-11 h-11 rounded-full ${platform.bgColor} flex items-center justify-center`}>
                      {channel?.pictureUrl ? (
                        <img
                          src={channel.pictureUrl}
                          alt={channel.displayName}
                          className="w-11 h-11 rounded-full object-cover"
                        />
                      ) : (
                        <PlatformIcon id={platform.id} color={platform.brandColor} />
                      )}
                    </div>
                    <div>
                      {channel ? (
                        <>
                          <div className="flex items-center gap-1.5">
                            <h4 className="font-semibold text-gray-900 truncate max-w-[180px]">
                              {channel.displayName}
                            </h4>
                            {channel.purposeLabel && (
                              <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] font-medium uppercase tracking-wide">
                                {channel.purposeLabel}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400">{platform.name}</p>
                        </>
                      ) : isAddTile ? (
                        <>
                          <h4 className="font-semibold text-gray-700">Add another</h4>
                          <p className="text-xs text-gray-400">{platform.name}</p>
                        </>
                      ) : (
                        <>
                          <h4 className="font-semibold text-gray-900">{platform.name}</h4>
                          <p className="text-xs text-gray-400">Not connected</p>
                        </>
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

                {!isAddTile && !isConnected && (
                  <p className="text-sm text-gray-600 mb-4">{platform.description}</p>
                )}
                {isAddTile && !isThisCardOAuth && (
                  <p className="text-sm text-gray-500 mb-4">
                    {platform.id === "instagram"
                      ? "আরেকটি Instagram অ্যাকাউন্ট যোগ করুন"
                      : "আরেকটি Facebook Page যোগ করুন"}
                  </p>
                )}

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
                        {availablePages.map((page) => {
                          const isAlreadyConnected = alreadyConnectedAssetIds.has(page.id);
                          return (
                            <label
                              key={page.id}
                              className={`flex items-center gap-3 p-2.5 rounded-lg border-2 transition-colors ${
                                isAlreadyConnected
                                  ? "border-gray-200 bg-gray-100 cursor-not-allowed opacity-70"
                                  : selectedPageIds.has(page.id)
                                  ? "border-blue-500 bg-white cursor-pointer"
                                  : "border-gray-200 bg-white hover:bg-gray-50 cursor-pointer"
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="w-4 h-4 accent-blue-600"
                                checked={selectedPageIds.has(page.id)}
                                disabled={isAlreadyConnected}
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
                              {isAlreadyConnected && (
                                <span className="flex items-center gap-1 text-[10px] font-medium text-green-700 bg-green-50 px-1.5 py-0.5 rounded-full flex-shrink-0">
                                  <Check className="w-3 h-3" />
                                  Connected
                                </span>
                              )}
                            </label>
                          );
                        })}
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

                {!isConnected && !isThisCardOAuth && isAddTile && (
                  <button
                    onClick={() => handleConnectClick(platform.id)}
                    className="w-full py-2.5 border-2 border-dashed border-gray-300 text-gray-700 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 hover:border-gray-400 hover:bg-gray-50 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    {platform.id === "instagram" ? "Add Instagram account" : "Add Facebook Page"}
                  </button>
                )}

                {!isConnected && !isThisCardOAuth && !isAddTile && (
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
                    <div className="mb-3">
                      <label
                        htmlFor={`purpose-label-${channel.id}`}
                        className="block text-[11px] font-medium text-gray-600 mb-1"
                      >
                        Label (optional)
                      </label>
                      <input
                        id={`purpose-label-${channel.id}`}
                        type="text"
                        maxLength={64}
                        defaultValue={channel.purposeLabel ?? ""}
                        placeholder="e.g. Sales, Live selling, Regional"
                        disabled={savingLabelId === channel.id}
                        onBlur={(e) =>
                          handleSavePurposeLabel(channel.id, e.target.value, channel.purposeLabel)
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                        className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 disabled:opacity-60"
                      />
                    </div>

                    <ChannelAutoReplyToggle channelId={channel.id} />

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
            </section>
          ))}
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
        {/* AI model selection is available on every plan — packages differ only
            by conversation quota, not by feature access. */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Cpu className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-gray-900">
                AI Model: Auto-Selected for Best Results
              </p>
              <p className="text-xs text-gray-600 mt-1">
                EasyMod আপনার সব কথোপকথনের জন্য সেরা মডেল স্বয়ংক্রিয়ভাবে বেছে নেয় — সব প্ল্যানে available।
              </p>
            </div>
          </div>
        </div>
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

/**
 * Per-channel AI auto-reply toggle. Loads the channel's MetaChannelSettings and
 * lets the merchant turn AI auto-reply on/off for that Page/IG account. This is
 * a per-channel control available on every plan — packages differ only by
 * conversation quota, never by feature access.
 */
function ChannelAutoReplyToggle({ channelId }: { channelId: string }) {
  const [settings, setSettings] = useState<MetaChannelSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getMetaChannelSettings(channelId)
      .then((s) => active && setSettings(s))
      .catch(() => active && setSettings(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [channelId]);

  const toggle = async () => {
    if (!settings || saving) return;
    const next = !settings.aiAutoReply;
    setSaving(true);
    try {
      const updated = await updateMetaChannelSettings(channelId, { aiAutoReply: next });
      setSettings(updated);
      toast.success(next ? "AI auto-reply চালু হয়েছে" : "AI auto-reply বন্ধ হয়েছে");
    } catch {
      toast.error("সেটিং সেভ করা যায়নি");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mb-3 flex items-center gap-2 text-xs text-gray-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> AI সেটিং লোড হচ্ছে…
      </div>
    );
  }
  if (!settings) return null;

  return (
    <div className="mb-3 flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <div className="flex items-center gap-2">
        <Cpu className="w-4 h-4 text-purple-600 flex-shrink-0" />
        <div>
          <p className="text-xs font-medium text-gray-800">AI auto-reply</p>
          <p className="text-[11px] text-gray-500">
            {settings.aiAutoReply
              ? "নতুন বার্তায় AI স্বয়ংক্রিয়ভাবে উত্তর দেবে"
              : "AI উত্তর বন্ধ — শুধু খসড়া তৈরি হবে"}
          </p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={settings.aiAutoReply}
        onClick={toggle}
        disabled={saving}
        title="AI auto-reply toggle"
        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
          settings.aiAutoReply ? "bg-purple-600" : "bg-gray-300"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
            settings.aiAutoReply ? "translate-x-4" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}
