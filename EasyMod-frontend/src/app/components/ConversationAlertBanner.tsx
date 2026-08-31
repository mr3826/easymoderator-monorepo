import { AlertTriangle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiClient } from "@/api";
import { authService } from "@/app/lib/auth";
import { usagePercentage } from "@/app/lib/usageThresholds";

type BannerState = {
  used: number;
  limit: number;
  percentage: number;
  quotaExhausted: boolean;
  periodStart: string;
  shopId: string;
};

export function ConversationAlertBanner() {
  const { t } = useTranslation();
  const shopId = authService.getCurrentShopId() || "unknown";
  const [state, setState] = useState<BannerState | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setState(null);
    apiClient.getSubscription()
      .then((data) => {
        if (!mounted || !data?.subscription) return;
        const metric = data.usage?.conversations;
        const periodStart = data.period?.start || data.subscription.current_period_start || "unknown";
        const limit = Number(data.effective_conversation_limit ?? metric?.limit ?? data.subscription.conversations_limit);
        const used = Number(metric?.used ?? data.subscription.conversations_used ?? 0);
        setState({
          used,
          limit,
          percentage: limit < 0 ? 0 : usagePercentage(used, limit),
          quotaExhausted: data.conversation_quota_exhausted === true,
          periodStart,
          shopId,
        });
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [shopId]);

  if (!state || state.limit < 0) return null;

  const threshold = state.quotaExhausted || state.percentage >= 100
    ? 100
    : state.percentage >= 90
      ? 90
      : state.percentage >= 70
        ? 70
        : null;
  const key = threshold === null
    ? null
    : `conversation-alert:${state.shopId}:${state.periodStart}:${threshold}`;
  if (threshold === null || dismissedKey === key || (key && sessionStorage.getItem(key) === "dismissed")) return null;

  const dismiss = () => {
    if (!key) return;
    sessionStorage.setItem(key, "dismissed");
    setDismissedKey(key);
  };

  const urgent = threshold >= 90;
  return (
    <div className={`mx-4 mt-3 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${urgent ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{t(`conversationAlert.threshold${threshold}.title`)}</p>
        <p className="mt-0.5">{t(`conversationAlert.threshold${threshold}.message`, { used: state.used, limit: state.limit })}</p>
        <Link to="/subscription" className="mt-1 inline-block font-semibold underline">
          {t("conversationAlert.manage")}
        </Link>
      </div>
      <button type="button" onClick={dismiss} className="rounded p-1 hover:bg-black/5" aria-label={t("conversationAlert.dismiss")}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export default ConversationAlertBanner;
