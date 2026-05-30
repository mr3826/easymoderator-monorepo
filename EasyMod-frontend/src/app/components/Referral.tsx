import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Gift, Copy, Check, Users, MessageCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/api";
import type { ReferralStats } from "@/api/domains/referral";

/**
 * Invite & Earn — the acquisition loop.
 *
 * Each shop shares its referral link; when an invited shop signs up, BOTH sides
 * earn bonus conversations. The strongest distribution channel in BD f-commerce
 * is seller-to-seller word of mouth, so the share targets are Messenger / copy link.
 */
export default function Referral() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    apiClient
      .getMyReferral()
      .then((s) => active && setStats(s))
      .catch(() => active && toast.error(t("referral.loadFailed")))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [t]);

  const shareUrl = stats?.code
    ? `${window.location.origin}/signup?ref=${encodeURIComponent(stats.code)}`
    : "";

  const referrerReward = stats?.rewards?.REFERRER_REWARD ?? 50;
  const referredReward = stats?.rewards?.REFERRED_REWARD ?? 50;

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success(t("referral.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("referral.copyFailed"));
    }
  };

  const shareMessage = t("referral.shareMessage", { reward: referredReward });

  const shareMessenger = () => {
    if (!shareUrl) return;
    const url = `https://www.facebook.com/dialog/send?app_id=140586622674265&link=${encodeURIComponent(
      shareUrl
    )}&redirect_uri=${encodeURIComponent(window.location.origin)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const shareNative = async () => {
    if (!shareUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: "EasyModerator", text: shareMessage, url: shareUrl });
      } catch {
        /* user cancelled — no-op */
      }
    } else {
      copyLink();
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      {/* Hero */}
      <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-2xl p-6 md:p-8 text-white shadow-sm">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-white/15">
            <Gift className="w-6 h-6" />
          </div>
          <h1 className="text-xl md:text-2xl font-bold">{t("referral.title")}</h1>
        </div>
        <p className="text-emerald-50 text-sm md:text-base">
          {t("referral.subtitle", { referrer: referrerReward, referred: referredReward })}
        </p>
      </div>

      {loading || !stats ? (
        <div className="flex items-center gap-2 py-10 justify-center text-gray-500 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> {t("common.loading")}
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                <Users className="w-4 h-4" /> {t("referral.statShops")}
              </div>
              <p className="text-2xl font-bold text-gray-900">{stats.total_referrals}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                <MessageCircle className="w-4 h-4" /> {t("referral.statEarned")}
              </div>
              <p className="text-2xl font-bold text-emerald-600">{stats.conversations_earned}</p>
            </div>
          </div>

          {/* Share link */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
            <div>
              <p className="text-sm font-semibold text-gray-900 mb-1">{t("referral.yourLink")}</p>
              <p className="text-xs text-gray-500">{t("referral.yourLinkHelp")}</p>
            </div>
            <div className="flex items-stretch gap-2">
              <input
                readOnly
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 px-3 py-2.5 text-sm rounded-lg border border-gray-200 bg-gray-50 text-gray-700"
              />
              <button
                type="button"
                onClick={copyLink}
                className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? t("referral.copiedShort") : t("referral.copy")}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={shareMessenger}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                <MessageCircle className="w-4 h-4" /> {t("referral.shareMessenger")}
              </button>
              <button
                type="button"
                onClick={shareNative}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                <Gift className="w-4 h-4" /> {t("referral.shareMore")}
              </button>
            </div>
            {stats.code && (
              <p className="text-xs text-gray-400">
                {t("referral.codeLabel")} <span className="font-mono font-semibold text-gray-600">{stats.code}</span>
              </p>
            )}
          </div>

          {/* How it works */}
          <div className="bg-emerald-50 rounded-2xl border border-emerald-100 p-5">
            <p className="text-sm font-semibold text-emerald-900 mb-3">{t("referral.howTitle")}</p>
            <ol className="space-y-2 text-sm text-emerald-800">
              <li className="flex gap-2"><span className="font-semibold">1.</span> {t("referral.how1")}</li>
              <li className="flex gap-2"><span className="font-semibold">2.</span> {t("referral.how2")}</li>
              <li className="flex gap-2"><span className="font-semibold">3.</span> {t("referral.how3", { referrer: referrerReward, referred: referredReward })}</li>
            </ol>
          </div>
        </>
      )}
    </div>
  );
}
