import { useEffect, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  Copy,
  Loader2,
  RefreshCw,
  Send,
  Smartphone,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  createTelegramConnectIntent,
  disconnectTelegramAlerts,
  getTelegramNotificationStatus,
  sendTelegramTestAlert,
  updateTelegramPreferences,
} from "@/api/domains/notification";
import type { TelegramNotificationStatus } from "@/api/types/notification";
import { getPushPermission, subscribeToPush } from "../lib/pushNotification";

type PushPermission = NotificationPermission | "unsupported";

function StatusPill({ tone, children }: { tone: "ok" | "warn" | "muted"; children: ReactNode }) {
  const classes = {
    ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warn: "border-amber-200 bg-amber-50 text-amber-700",
    muted: "border-gray-200 bg-gray-50 text-gray-600",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${classes[tone]}`}>
      {children}
    </span>
  );
}

function Panel({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-start gap-3 border-b border-gray-100 px-4 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-700">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <p className="mt-1 text-xs leading-5 text-gray-500">{subtitle}</p>
        </div>
      </div>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

export default function NotificationSettings() {
  const { t } = useTranslation();
  const [telegram, setTelegram] = useState<TelegramNotificationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [telegramBusy, setTelegramBusy] = useState<string | null>(null);
  const [pushPermission, setPushPermission] = useState<PushPermission>(() => getPushPermission());
  const [browserBusy, setBrowserBusy] = useState(false);

  const unreadableStatus = telegram?.status === "unhealthy";
  const statusTone = telegram?.connected ? "ok" : unreadableStatus || telegram?.status === "pending" ? "warn" : "muted";
  const statusLabel = telegram?.connected
    ? t("manageShop.notifications.telegram.connected")
    : telegram?.status === "pending"
      ? t("manageShop.notifications.telegram.pending")
      : telegram?.status === "unhealthy"
        ? t("manageShop.notifications.telegram.unhealthy")
        : t("manageShop.notifications.telegram.disconnected");

  const events = useMemo(() => telegram?.events || [], [telegram?.events]);

  const loadTelegram = async () => {
    setLoading(true);
    try {
      setTelegram(await getTelegramNotificationStatus());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("manageShop.notifications.errors.load"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTelegram();
  }, []);

  const enableBrowserNotifications = async () => {
    setBrowserBusy(true);
    try {
      const ok = await subscribeToPush();
      setPushPermission(getPushPermission());
      if (ok) toast.success(t("manageShop.notifications.browser.enabled"));
      else toast.error(t("manageShop.notifications.browser.failed"));
    } catch (error) {
      setPushPermission(getPushPermission());
      toast.error(error instanceof Error ? error.message : t("manageShop.notifications.browser.failed"));
    } finally {
      setBrowserBusy(false);
    }
  };

  const createIntent = async () => {
    setTelegramBusy("connect");
    try {
      setTelegram(await createTelegramConnectIntent());
      toast.success(t("manageShop.notifications.telegram.intentCreated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("manageShop.notifications.telegram.intentFailed"));
    } finally {
      setTelegramBusy(null);
    }
  };

  const copyCommand = async () => {
    if (!telegram?.pendingCommand) return;
    await navigator.clipboard?.writeText(telegram.pendingCommand);
    toast.success(t("manageShop.notifications.telegram.copied"));
  };

  const refresh = async () => {
    setTelegramBusy("refresh");
    try {
      await loadTelegram();
    } finally {
      setTelegramBusy(null);
    }
  };

  const sendTest = async () => {
    setTelegramBusy("test");
    try {
      await sendTelegramTestAlert();
      toast.success(t("manageShop.notifications.telegram.testSent"));
      setTelegram(await getTelegramNotificationStatus());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("manageShop.notifications.telegram.testFailed"));
    } finally {
      setTelegramBusy(null);
    }
  };

  const disconnect = async () => {
    setTelegramBusy("disconnect");
    try {
      const nextStatus = await disconnectTelegramAlerts();
      setTelegram(nextStatus || await getTelegramNotificationStatus());
      toast.success(t("manageShop.notifications.telegram.disconnectedToast"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("manageShop.notifications.telegram.disconnectFailed"));
    } finally {
      setTelegramBusy(null);
    }
  };

  const togglePreference = async (eventType: string, enabled: boolean) => {
    if (!telegram) return;
    const optimistic = {
      ...telegram,
      preferences: { ...telegram.preferences, [eventType]: enabled },
      events: telegram.events.map(event => event.eventType === eventType ? { ...event, enabled } : event),
    };
    setTelegram(optimistic);

    try {
      setTelegram(await updateTelegramPreferences(optimistic.preferences));
    } catch (error) {
      setTelegram(telegram);
      toast.error(error instanceof Error ? error.message : t("manageShop.notifications.telegram.preferenceFailed"));
    }
  };

  return (
    <div className="max-w-5xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 md:text-2xl">{t("manageShop.notifications.title")}</h1>
        <p className="mt-1 text-sm text-gray-500">{t("manageShop.notifications.subtitle")}</p>
      </div>

      <div className="grid gap-4">
        <Panel
          icon={Smartphone}
          title={t("manageShop.notifications.browser.title")}
          subtitle={t("manageShop.notifications.browser.subtitle")}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <StatusPill tone={pushPermission === "granted" ? "ok" : pushPermission === "denied" ? "warn" : "muted"}>
              {pushPermission === "unsupported" ? t("manageShop.notifications.browser.unsupported") : pushPermission}
            </StatusPill>
            <button
              type="button"
              onClick={enableBrowserNotifications}
              disabled={browserBusy || pushPermission === "unsupported" || pushPermission === "granted"}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {browserBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
              {t("manageShop.notifications.browser.enable")}
            </button>
          </div>
        </Panel>

        <Panel
          icon={Bell}
          title={t("manageShop.notifications.inApp.title")}
          subtitle={t("manageShop.notifications.inApp.subtitle")}
        >
          <div className="flex items-center gap-3 text-sm text-gray-700">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <span>{t("manageShop.notifications.inApp.active")}</span>
          </div>
        </Panel>

        <Panel
          icon={Send}
          title={t("manageShop.notifications.telegram.title")}
          subtitle={t("manageShop.notifications.telegram.subtitle")}
        >
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={statusTone}>{statusLabel}</StatusPill>
                  {telegram?.chatTitle && <span className="text-sm font-medium text-gray-800">{telegram.chatTitle}</span>}
                </div>
                <button
                  type="button"
                  onClick={refresh}
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  <RefreshCw className={`h-4 w-4 ${telegramBusy === "refresh" ? "animate-spin" : ""}`} />
                  {t("common.retry")}
                </button>
              </div>

              {!telegram?.configured && (
                <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{t("manageShop.notifications.telegram.notConfigured")}</span>
                </div>
              )}

              {!telegram?.connected && (
                <div className="space-y-3 rounded-lg border border-gray-200 p-3">
                  <div className="text-sm font-semibold text-gray-900">
                    {t("manageShop.notifications.telegram.groupName", { name: telegram?.suggestedGroupName })}
                  </div>
                  <button
                    type="button"
                    onClick={createIntent}
                    disabled={telegramBusy === "connect" || !telegram?.configured}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    {telegramBusy === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {t("manageShop.notifications.telegram.connect")}
                  </button>

                  {telegram?.pendingCommand && (
                    <div className="space-y-3">
                      <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-600">
                        {(telegram.instructions || []).map((instruction) => (
                          <li key={instruction}>{instruction}</li>
                        ))}
                      </ol>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <code className="min-h-10 flex-1 overflow-x-auto rounded-lg bg-gray-900 px-3 py-2 text-sm text-white">
                          {telegram.pendingCommand}
                        </code>
                        <button
                          type="button"
                          onClick={copyCommand}
                          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          <Copy className="h-4 w-4" />
                          {t("manageShop.notifications.telegram.copy")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {telegram?.connected && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={sendTest}
                    disabled={telegramBusy === "test"}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white disabled:bg-gray-300"
                  >
                    {telegramBusy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {t("manageShop.notifications.telegram.test")}
                  </button>
                  <button
                    type="button"
                    onClick={disconnect}
                    disabled={telegramBusy === "disconnect"}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-red-200 px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                  >
                    {telegramBusy === "disconnect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    {t("common.disconnect")}
                  </button>
                </div>
              )}

              {events.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {events.map((event) => (
                    <label
                      key={event.eventType}
                      className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="block font-medium text-gray-900">{event.label}</span>
                        <span className="block truncate text-xs text-gray-500">{event.labelBn}</span>
                      </span>
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300 text-blue-600"
                        checked={event.enabled}
                        disabled={!telegram}
                        onChange={(e) => togglePreference(event.eventType, e.target.checked)}
                      />
                    </label>
                  ))}
                </div>
              )}

              {telegram?.lastError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {telegram.lastError}
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
