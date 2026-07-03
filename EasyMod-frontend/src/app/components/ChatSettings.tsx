import { useEffect, useRef, useState } from "react";
import {
  MessageSquare,
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
  connectMetaAsset,
  pingMetaChannel,
  disconnectMetaChannel,
  reconnectMetaChannel,
  getMetaChannelConsentSummary,
  updateMetaChannelPurposeLabel,
  getMetaChannelSettings,
  updateMetaChannelSettings,
  type MetaChannel,
  type MetaOAuthAsset,
  type MetaChannelConsentSummary,
  type MetaConsentEventType,
  type MetaChannelSettings,
} from "@/api/domains/meta-channels";
import { getMetaErrorMessage, extractMetaApiError } from "@/lib/meta/error-messages";
import { trackFunnelEvent } from "@/app/lib/funnel";

// Facebook-only launch — Instagram was removed from product scope (2026-06-24).
const FB_BRAND = "#1877F2";
const OAUTH_NONCE_KEY = "easymod_oauth_nonce";

function FacebookIcon({ color = FB_BRAND, size = 22 }: { color?: string; size?: number }) {
  return <MessageSquare style={{ color, width: size, height: size }} />;
}

export default function ChatSettings() {
  const { t, i18n } = useTranslation();

  // Surface the *real* reason a Meta connect/callback failed. Shows a
  // merchant-friendly headline (mapped from the Meta error) plus the raw
  // backend message as a sub-line, and logs the full error for support/QA.
  const reportConnectError = (context: string, err: unknown) => {
    const { code, message } = extractMetaApiError(err);
    const lang = i18n.language?.startsWith("en") ? "en" : "bn";
    const friendly = getMetaErrorMessage(code, message, lang);
    // eslint-disable-next-line no-console
    console.error(`[Meta connect] ${context} failed`, { code, message, err });
    toast.error(friendly, message ? { description: message, duration: 12000 } : undefined);
  };

  const [channels, setChannels] = useState<MetaChannel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeOAuth, setActiveOAuth] = useState<{
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
  const [permissionsExpanded, setPermissionsExpanded] = useState(false);
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
      toast.success(normalized ? t("channels.label.updated", { label: normalized }) : t("channels.label.cleared"));
    } catch (error: any) {
      const msg = error.response?.data?.error?.message || t("channels.label.updateFailed");
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
        fetched.filter((c) => c.platform === "facebook" && c.status !== "DISCONNECTED"),
      );
    } catch (error: unknown) {
      const { code, message } = extractMetaApiError(error);
      setLoadError(getMetaErrorMessage(code, message, "en"));
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

  // Single Facebook connect flow — one popup, then a multi-select page picker so
  // the merchant can connect one OR several Facebook Pages at once.
  const handleConnect = async () => {
    if (oauthInProgressRef.current) {
      toast.error(t("channels.errors.oauthInProgress"));
      return;
    }
    oauthInProgressRef.current = true;
    try {
      trackFunnelEvent("facebook_connect_started", { surface: "chat_settings" });
      const { redirectUrl } = await initiateMetaOAuth("facebook");

      try {
        const urlState = new URL(redirectUrl).searchParams.get("state");
        if (urlState) sessionStorage.setItem(OAUTH_NONCE_KEY, urlState);
      } catch {
        /* non-critical */
      }
      sessionStorage.setItem("easymod_oauth_channel_type", "facebook");

      oauthPopupRef.current = window.open(
        redirectUrl,
        "meta_oauth",
        "width=600,height=700,left=200,top=100",
      );
      setActiveOAuth({ step: "connecting" });

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
              setActiveOAuth({ step: "page-select" });
            })
            .catch((err) => {
              reportConnectError("OAuth callback", err);
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

  const handleRetryOAuthAssetLookup = () => {
    handleCancelOAuth();
    setTimeout(() => void handleConnect(), 0);
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
          platform: "facebook",
        });
        if (result.webhookWarning) webhookWarning = result.webhookWarning;
      }
      await fetchChannels();
      trackFunnelEvent("facebook_connect_succeeded", {
        pages_connected: selectedPageIds.size,
      }, { onceKey: "facebook_connect_succeeded" });
      setActiveOAuth(null);
      setAvailablePages([]);
      setSelectedPageIds(new Set());
      setTempToken("");
      toast.success(t("channels.connectSuccess"));
      if (webhookWarning) {
        setTimeout(() => toast.warning(webhookWarning!, { duration: 12000 }), 500);
      }
    } catch (err) {
      reportConnectError("connect-asset", err);
    } finally {
      setIsConnectingPage(false);
    }
  };

  const handleTestPipeline = async (channelId: string) => {
    setTestingId(channelId);
    try {
      const result = await pingMetaChannel(channelId);
      if (result.ping.ok) {
        toast.success(t("channels.test.ok", { ms: result.ping.latencyMs ?? "?" }), { duration: 8000 });
      } else {
        toast.error(t("channels.test.failed", { error: result.ping.error }), { duration: 15000 });
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? t("channels.test.error"));
    } finally {
      setTestingId(null);
    }
  };

  const handleDisconnect = async (channel: MetaChannel) => {
    setDisconnectingId(channel.id);
    try {
      await disconnectMetaChannel(channel.id);
      toast.success(t("channels.disconnectedNamed", { name: channel.displayName }));
      await fetchChannels();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("channels.errors.disconnectFailed"));
    } finally {
      setDisconnectingId(null);
      setConfirmDisconnect(null);
    }
  };

  const handleReconnect = async (channel: MetaChannel) => {
    if (oauthInProgressRef.current) {
      toast.error(t("channels.errors.oauthInProgress", "একটি সংযোগ ইতিমধ্যে চলছে। আগের সংযোগ শেষ করুন।"));
      return;
    }
    oauthInProgressRef.current = true;
    try {
      const { redirectUrl, state } = await reconnectMetaChannel(channel.id);

      try {
        if (state) sessionStorage.setItem(OAUTH_NONCE_KEY, state);
      } catch {
        /* non-critical */
      }
      sessionStorage.setItem("easymod_oauth_channel_type", "facebook");

      oauthPopupRef.current = window.open(
        redirectUrl,
        "meta_oauth",
        "width=600,height=700,left=200,top=100",
      );
      setActiveOAuth({ step: "connecting" });

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
              setActiveOAuth({ step: "page-select" });
            })
            .catch((err) => {
              reportConnectError("OAuth callback", err);
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
      toast.error(err?.response?.data?.error?.message || t("channels.consent.loadFailed"));
      setExpandedConsentChannelId(null);
    } finally {
      setLoadingConsentId(null);
    }
  };

  const consentEventLabel = (event: MetaConsentEventType): string =>
    ({
      OPT_IN_IMPLICIT: t("channels.consent.events.optInImplicit"),
      OPT_IN_EXPLICIT: t("channels.consent.events.optInExplicit"),
      OPT_OUT: t("channels.consent.events.optOut"),
      DEAUTHORIZED: t("channels.consent.events.deauthorized"),
      DATA_DELETED: t("channels.consent.events.dataDeleted"),
    }[event] || event);

  const consentEventBadgeClass = (event: MetaConsentEventType): string =>
    event === "OPT_OUT" || event === "DEAUTHORIZED" || event === "DATA_DELETED"
      ? "bg-red-50 text-red-700"
      : "bg-green-50 text-green-700";

  // Asset IDs already connected — used to disable those rows in the page picker.
  const alreadyConnectedAssetIds = new Set(channels.map((c) => c.metaAssetId));

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg">
          <MessageSquare className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-gray-900">{t("channels.settings.title")}</h2>
          <p className="text-sm text-gray-500">{t("channels.settings.subtitle")}</p>
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
            {t("common.retry")}
          </button>
        </div>
      )}

      {/* Connect flow (first-time + add another) */}
      {!isLoading && !loadError && activeOAuth && (
        <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-white border-2 border-blue-300 flex items-center justify-center">
              <MessageSquare className="w-3.5 h-3.5" style={{ color: FB_BRAND }} />
            </div>
            <h3 className="font-semibold text-gray-900">{t("channels.connectCard.title")}</h3>
          </div>

          {activeOAuth.step === "connecting" && (
            <div className="text-center py-4">
              <Loader2 className="w-7 h-7 animate-spin mx-auto mb-2 text-blue-600" />
              <p className="text-sm text-gray-700">{t("channels.connectCard.loginPopup")}</p>
              <button
                onClick={handleCancelOAuth}
                className="mt-2 text-xs text-gray-600 hover:text-gray-800 underline"
              >
                {t("common.cancel")}
              </button>
            </div>
          )}

          {activeOAuth.step === "page-select" && (
            <div>
              <p className="text-xs text-gray-700 mb-3">
                {t("channels.connectCard.selectPagesHint")}
              </p>
              {availablePages.length === 0 ? (
                <NoMetaAssetsFound onRetry={handleRetryOAuthAssetLookup} onCancel={handleCancelOAuth} />
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
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
                          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                            <FacebookIcon size={14} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 text-sm truncate">{page.name}</p>
                          <p className="text-[10px] uppercase tracking-wide text-gray-500">Facebook Page</p>
                        </div>
                        {isAlreadyConnected && (
                          <span className="flex items-center gap-1 text-[10px] font-medium text-green-700 bg-green-50 px-1.5 py-0.5 rounded-full flex-shrink-0">
                            <Check className="w-3 h-3" />
                            {t("channels.health.connected")}
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
                  {t("common.cancel")}
                </button>
                <button
                  onClick={handleConnectPages}
                  disabled={selectedPageIds.size === 0 || isConnectingPage}
                  className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {isConnectingPage && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {t("channels.connectCard.connectCount", { count: selectedPageIds.size })}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!isLoading && !loadError && !activeOAuth && (
        <div className="space-y-3">
          <button
            onClick={handleConnect}
            className="w-full rounded-xl border-2 border-blue-400 bg-gradient-to-r from-blue-50 to-blue-100 hover:from-blue-100 hover:to-blue-200 p-4 flex items-center justify-center gap-3 transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-white border-2 border-blue-300 flex items-center justify-center">
              <MessageSquare className="w-3.5 h-3.5" style={{ color: FB_BRAND }} />
            </div>
            <span className="font-semibold text-gray-900 text-sm">
              {channels.length === 0 ? t("channels.connectCard.title") : t("channels.connectCard.addAnother")}
            </span>
          </button>

          <button
            onClick={() => setPermissionsExpanded((v) => !v)}
            className="w-full text-xs text-gray-500 hover:text-gray-700 flex items-center justify-center gap-1"
          >
            <Shield className="w-3.5 h-3.5" />
            {permissionsExpanded ? t("channels.permissions.hide") : t("channels.permissions.show")}
            {permissionsExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {permissionsExpanded && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-xs text-gray-700">
              <ul className="space-y-1 list-disc list-inside">
                <li><strong>pages_show_list</strong> — {t("channels.permissions.pagesShowList")}</li>
                <li><strong>pages_messaging</strong> — {t("channels.permissions.pagesMessaging")}</li>
                <li><strong>pages_manage_metadata</strong> — {t("channels.permissions.pagesManageMetadata")}</li>
              </ul>
              <p className="mt-2 text-gray-500 text-[11px]">
                {t("channels.permissions.note")}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Connected channels */}
      {!isLoading && !loadError && channels.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {channels.map((channel) => {
            const isConnected = channel.status === "CONNECTED";
            const isTokenExpired = channel.status === "TOKEN_EXPIRED" || channel.status === "REVOKED";
            const isErrored = channel.status === "ERROR";
            const isActionRequired =
              channel.status === "ERROR" &&
              (channel.lastError === "webhook_subscription_unverified" ||
                channel.lastError === "webhook_subscription_failed");
            const isConsentExpanded = expandedConsentChannelId === channel.id;
            const consentSummary = consentByChannelId[channel.id];
            const isConsentLoading = loadingConsentId === channel.id;

            return (
              <div
                key={channel.id}
                className="bg-white border border-gray-200 rounded-xl shadow-sm transition-shadow p-5 hover:shadow-md"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-blue-50 flex items-center justify-center">
                      {channel.pictureUrl ? (
                        <img
                          src={channel.pictureUrl}
                          alt={channel.displayName}
                          className="w-11 h-11 rounded-full object-cover"
                        />
                      ) : (
                        <FacebookIcon />
                      )}
                    </div>
                    <div>
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
                      <p className="text-xs text-gray-400">Facebook Messenger</p>
                    </div>
                  </div>
                  {isConnected && (
                    <span className="flex items-center gap-1 px-2.5 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                      <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                      {t("channels.statusActive")}
                    </span>
                  )}
                  {isTokenExpired && (
                    <span className="flex items-center gap-1 px-2.5 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">
                      <AlertCircle className="w-3 h-3" />
                      {t("channels.badge.reconnect")}
                    </span>
                  )}
                  {isErrored && isActionRequired && (
                    <span className="flex items-center gap-1 px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">
                      <AlertCircle className="w-3 h-3" />
                      {t("channels.badge.actionRequired", "Action Required")}
                    </span>
                  )}
                  {isErrored && !isActionRequired && (
                    <span className="flex items-center gap-1 px-2.5 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                      <AlertCircle className="w-3 h-3" />
                      {t("channels.badge.error", "Error")}
                    </span>
                  )}
                </div>

                {isConnected &&
                  channel.tokenExpiresAt &&
                  (() => {
                    const expiresMs = new Date(channel.tokenExpiresAt).getTime() - Date.now();
                    const dayMs = 86_400_000;
                    if (expiresMs > 14 * dayMs) return null;
                    const label =
                      expiresMs < 0
                        ? t("channels.tokenExpired")
                        : t("channels.tokenExpiresIn", { days: Math.ceil(expiresMs / dayMs) });
                    return (
                      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-4 text-xs text-amber-800">
                        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>{label}</span>
                      </div>
                    );
                  })()}

                {!isConnected && isTokenExpired && (
                  <button
                    onClick={() => handleReconnect(channel)}
                    style={{ backgroundColor: FB_BRAND }}
                    className="w-full py-2.5 text-white rounded-lg font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity mb-3"
                  >
                    <FacebookIcon color="white" size={18} />
                    {t("channels.reconnectPage")}
                  </button>
                )}

                {isConnected && (
                  <>
                    <div className="mb-3">
                      <label
                        htmlFor={`purpose-label-${channel.id}`}
                        className="block text-[11px] font-medium text-gray-600 mb-1"
                      >
                        {t("channels.label.fieldLabel")}
                      </label>
                      <input
                        id={`purpose-label-${channel.id}`}
                        type="text"
                        maxLength={64}
                        defaultValue={channel.purposeLabel ?? ""}
                        placeholder={t("channels.label.placeholder")}
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

                    <div className="mb-3 grid grid-cols-2 gap-1.5 text-[11px]">
                      <HealthRow
                        label={t("channels.health.connection", "Connection")}
                        ok={channel.status === "CONNECTED"}
                        okText={t("channels.health.connected", "Connected")}
                        badText={channel.status}
                      />
                      <HealthRow
                        label={t("channels.health.webhook", "Webhook")}
                        ok={!!channel.webhookLastVerifiedAt}
                        okText={t("channels.health.active", "Active")}
                        badText={t("channels.health.notVerified", "Not verified")}
                      />
                      <HealthRow
                        label={t("channels.health.token", "Token")}
                        ok={
                          !channel.tokenExpiresAt ||
                          new Date(channel.tokenExpiresAt).getTime() > Date.now()
                        }
                        okText={t("channels.health.valid", "Valid")}
                        badText={t("channels.health.expired", "Expired")}
                      />
                      <HealthRow
                        label={t("channels.health.lastWebhook", "Last webhook")}
                        ok={!!channel.webhookLastVerifiedAt}
                        okText={
                          channel.webhookLastVerifiedAt
                            ? new Date(channel.webhookLastVerifiedAt).toLocaleDateString()
                            : "—"
                        }
                        badText={t("channels.health.noneYet", "None yet")}
                        neutral
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <button
                        onClick={() => handleTestPipeline(channel.id)}
                        disabled={testingId === channel.id}
                        title={t("channels.actions.testTitle")}
                        className="flex items-center justify-center gap-1 px-2 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-xs hover:bg-gray-50 disabled:opacity-60"
                      >
                        {testingId === channel.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <FlaskConical className="w-3.5 h-3.5" />
                        )}
                        {t("channels.actions.test", "Test")}
                      </button>
                      <button
                        onClick={fetchChannels}
                        title={t("channels.actions.refreshList")}
                        className="flex items-center justify-center gap-1 px-2 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-xs hover:bg-gray-50"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        {t("channels.actions.refreshList", "Refresh list")}
                      </button>
                      <button
                        onClick={() => handleReconnect(channel)}
                        title={t("channels.actions.refreshPermissions")}
                        className="flex items-center justify-center gap-1 px-2 py-1.5 border border-blue-200 text-blue-700 rounded-lg text-xs hover:bg-blue-50"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        {t("channels.actions.refreshPermissions", "Refresh permissions")}
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
                        {t("channels.actions.disconnect", "Disconnect")}
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
                            <span className="font-medium">{t("channels.consent.activity")}</span>
                            {consentSummary && (
                              <span className="ml-1 text-gray-500">
                                {t("channels.consent.optInsCount", { count: consentSummary.counts.optIns })}
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
                                    <p className="text-[9px] uppercase text-green-700/80">{t("channels.consent.optIns")}</p>
                                  </div>
                                  <div className="rounded bg-red-50 px-1.5 py-1.5">
                                    <p className="text-sm font-semibold text-red-700">
                                      {consentSummary.counts.optOuts}
                                    </p>
                                    <p className="text-[9px] uppercase text-red-700/80">{t("channels.consent.optOuts")}</p>
                                  </div>
                                  <div className="rounded bg-gray-100 px-1.5 py-1.5">
                                    <p className="text-sm font-semibold text-gray-600">
                                      {consentSummary.counts.deauthorized}
                                    </p>
                                    <p className="text-[9px] uppercase text-gray-500">{t("channels.consent.deauth")}</p>
                                  </div>
                                  <div className="rounded bg-gray-100 px-1.5 py-1.5">
                                    <p className="text-sm font-semibold text-gray-600">
                                      {consentSummary.counts.dataDeleted}
                                    </p>
                                    <p className="text-[9px] uppercase text-gray-500">{t("channels.consent.erased")}</p>
                                  </div>
                                </div>
                                {consentSummary.recentEvents.length === 0 ? (
                                  <p className="text-xs text-gray-400 italic">
                                    {t("channels.consent.noEvents")}
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
            <h3 className="text-base font-semibold text-gray-900">{t("channels.aiModel.title")}</h3>
            <p className="text-sm text-gray-500">{t("channels.aiModel.subtitle")}</p>
          </div>
        </div>
        {/* AI model selection is available on every plan — packages differ only
            by conversation quota, not by feature access. */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Cpu className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-gray-900">
                {t("channels.aiModel.autoSelectedTitle")}
              </p>
              <p className="text-xs text-gray-600 mt-1">
                {t("channels.aiModel.autoSelectedDesc")}
              </p>
            </div>
          </div>
        </div>
      </div>

      {confirmDisconnect && (
        <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6 space-y-4">
            <h3 className="font-semibold text-gray-900 text-lg">
              {t("channels.disconnectModal.title", { name: confirmDisconnect.displayName })}
            </h3>
            <p className="text-sm text-gray-600">
              {t("channels.disconnectModal.message")}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDisconnect(null)}
                className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => handleDisconnect(confirmDisconnect)}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700"
              >
                {t("channels.disconnectModal.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NoMetaAssetsFound({
  onRetry,
  onCancel,
}: {
  onRetry: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-left">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-900">{t("channels.noPages.title")}</p>
          <p className="mt-1 text-xs text-amber-800">
            {t("channels.noPages.desc")}
          </p>
        </div>
      </div>

      <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-amber-900">
        <li>{t("channels.noPages.step1")}</li>
        <li>{t("channels.noPages.step2")}</li>
        <li>{t("channels.noPages.step3")}</li>
        <li>{t("channels.noPages.step4")}</li>
      </ol>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <a
          href="https://business.facebook.com/settings"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex flex-1 items-center justify-center rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100"
        >
          {t("channels.noPages.openSettings")}
        </a>
        <button
          type="button"
          onClick={onRetry}
          className="flex-1 rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-800"
        >
          {t("channels.noPages.tryAgain")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100"
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

/**
 * Compact single-row health indicator used inside the per-channel health grid.
 */
function HealthRow({
  label,
  ok,
  okText,
  badText,
  neutral = false,
}: {
  label: string;
  ok: boolean;
  okText: string;
  badText: string;
  neutral?: boolean;
}) {
  const tone = neutral ? "text-gray-500" : ok ? "text-green-700" : "text-amber-700";
  return (
    <div className="flex items-center justify-between rounded bg-gray-50 px-2 py-1">
      <span className="text-gray-500">{label}</span>
      <span className={`font-medium ${tone}`}>{ok ? okText : badText}</span>
    </div>
  );
}

/**
 * Per-channel AI auto-reply toggle. Loads the channel's MetaChannelSettings and
 * lets the merchant turn AI auto-reply on/off for that Page. This is a
 * per-channel control available on every plan — packages differ only by
 * conversation quota, never by feature access.
 */
function ChannelAutoReplyToggle({ channelId }: { channelId: string }) {
  const { t } = useTranslation();
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
      toast.success(next ? t("channels.autoReply.enabledToast") : t("channels.autoReply.disabledToast"));
    } catch {
      toast.error(t("channels.autoReply.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mb-3 flex items-center gap-2 text-xs text-gray-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("channels.autoReply.loading")}
      </div>
    );
  }
  if (!settings) return null;

  return (
    <div className="mb-3 flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <div className="flex items-center gap-2">
        <Cpu className="w-4 h-4 text-purple-600 flex-shrink-0" />
        <div>
          <p className="text-xs font-medium text-gray-800">{t("channels.autoReply.title")}</p>
          <p className="text-[11px] text-gray-500">
            {settings.aiAutoReply
              ? t("channels.autoReply.onDesc")
              : t("channels.autoReply.offDesc")}
          </p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={settings.aiAutoReply}
        onClick={toggle}
        disabled={saving}
        title={t("channels.autoReply.toggleTitle")}
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
