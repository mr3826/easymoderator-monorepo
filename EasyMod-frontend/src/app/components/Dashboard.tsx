import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Bot, CheckCircle2, Clock4, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/api";

type PulseData = {
  todaySales: number;
  confirmedOrders: number;
  missedReplies: number;
  botReplies: number;
  needsAttention: number;
  atRiskCount: number;
  lastFiveOrders: Awaited<ReturnType<typeof apiClient.getOrders>>;
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [pulseData, setPulseData] = useState<PulseData | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // AbortController for request cancellation on unmount
  const abortControllerRef = useRef<AbortController | null>(null);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("bn-BD", {
      style: "currency",
      currency: "BDT",
      maximumFractionDigits: 0,
    }).format(Number.isFinite(value) ? value : 0);

  const formatOrderStatus = (status: string) => {
    switch (status) {
      case "confirmed":
      case "completed":
        return { label: "নিশ্চিত ✅", className: "text-green-700 bg-green-50" };
      case "cancelled":
        return { label: "বাতিল ❌", className: "text-red-600 bg-red-50" };
      case "processing":
        return { label: "পেন্ডিং 🕐", className: "text-orange-600 bg-orange-50" };
      default:
        return { label: "পেমেন্ট বাকি 💳", className: "text-orange-600 bg-orange-50" };
    }
  };

  const refreshPulse = useCallback(async (isInitialLoad = false) => {
    try {
      if (isInitialLoad) {
        setIsLoading(true);
      }
      setError(null);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const [metricsResult, queueResult, ordersResult] = await Promise.allSettled([
        apiClient.getDashboardMetrics(),
        apiClient.getDashboardQueue(),
        apiClient.getOrders({
          start_date: new Date().toISOString().slice(0, 10),
          end_date: new Date().toISOString().slice(0, 10),
          limit: 5,
        }),
      ]);

      if (metricsResult.status === 'rejected') {
        console.error('Failed to load dashboard metrics:', metricsResult.reason);
      }
      if (queueResult.status === 'rejected') {
        console.error('Failed to load dashboard queue:', queueResult.reason);
      }

      // If all three fail together, show an error instead of a zero-filled dashboard
      if (metricsResult.status === 'rejected' && queueResult.status === 'rejected' && ordersResult.status === 'rejected') {
        setError("ড্যাশবোর্ড লোড করা যায়নি। ইন্টারনেট সংযোগ যাচাই করুন।");
        return;
      }

      // Partial failures get a non-blocking warning on refresh (not on initial load)
      const failCount = [metricsResult, queueResult, ordersResult].filter(r => r.status === 'rejected').length;
      if (!isInitialLoad && failCount > 0) {
        toast.warning("কিছু ডেটা আপডেট করা যায়নি।");
      }

      const metrics = metricsResult.status === 'fulfilled' ? metricsResult.value : null;
      const queue = queueResult.status === 'fulfilled' ? queueResult.value : null;
      const todayOrders = ordersResult.status === 'fulfilled' ? ordersResult.value : [];

      const todaySales = todayOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
      const confirmedOrders = todayOrders.filter(
        (order) => order.status === "confirmed" || order.status === "completed",
      ).length;

      setPulseData({
        todaySales,
        confirmedOrders,
        missedReplies: queue?.unread_count || 0,
        botReplies: metrics?.analytics?.llm_calls || 0,
        needsAttention: (queue?.unread_count || 0) + (queue?.pending_payment_count || 0),
        atRiskCount: queue?.at_risk_orders?.length || 0,
        lastFiveOrders: todayOrders,
      });
      setLastUpdatedAt(new Date());
    } catch (loadError: unknown) {
      const e = loadError as { response?: { data?: { error?: { message?: string } } } };
      setError(e?.response?.data?.error?.message ?? "Dashboard load failed.");
    } finally {
      if (isInitialLoad) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    refreshPulse(true);
    const timer = window.setInterval(() => refreshPulse(false), 60000);
    return () => {
      window.clearInterval(timer);
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, [refreshPulse]);

  const cards = useMemo(() => {
    if (!pulseData) {
      return [];
    }
    return [
      {
        label: "আজকের বিক্রি",
        value: formatCurrency(pulseData.todaySales),
        icon: Wallet,
        className: "bg-card border border-border",
      },
      {
        label: "নিশ্চিত হয়েছে",
        value: `${pulseData.confirmedOrders} টি অর্ডার`,
        icon: CheckCircle2,
        className: "bg-card border border-border",
      },
      {
        label: "উত্তর দেওয়া হয়নি",
        value: `${pulseData.missedReplies} টি মিস`,
        icon: Clock4,
        className: "bg-red-50 border border-red-200",
      },
    ];
  }, [pulseData]);

  if (isLoading) {
    return (
      <div className="min-h-full bg-background p-4 md:p-6">
        <div className="mb-4 flex items-center gap-2 text-gray-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm font-semibold">আজকের অবস্থা লোড হচ্ছে...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-full bg-background p-4 md:p-6">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-red-600" />
            <div className="space-y-1">
              <h3 className="text-base font-bold text-red-900">ড্যাশবোর্ড লোড করা যায়নি</h3>
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
          <button
            onClick={() => refreshPulse(true)}
            className="mt-4 min-h-12 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white"
          >
            আবার চেষ্টা করুন
          </button>
        </div>
      </div>
    );
  }

  if (!pulseData) {
    return null;
  }

  return (
    <div className="min-h-full bg-background p-4 md:p-6">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-foreground md:text-2xl">আজকের অবস্থা</h1>
          <p className="text-sm text-muted-foreground">শপের দ্রুত আপডেট, এক নজরে</p>
        </div>
        <button
          onClick={() => refreshPulse(false)}
          className="min-h-12 rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground"
        >
          রিফ্রেশ
        </button>
      </div>

      <section className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        {cards.map((card, index) => {
          const Icon = card.icon;
          const isMissCard = index === 2;

          return (
            <button
              key={card.label}
              onClick={() => {
                if (isMissCard) {
                  navigate("/app/inbox?tab=needs_review");
                }
              }}
              className={`${card.className} min-h-[112px] rounded-2xl p-4 text-left ${isMissCard ? "cursor-pointer" : "cursor-default"}`}
              type="button"
            >
              <div className="mb-2 flex items-center justify-between">
                <Icon className="h-5 w-5 text-gray-700" />
                {isMissCard && <span className="text-xs font-bold text-red-700">দেখুন</span>}
              </div>
              <p className="text-2xl font-black text-foreground md:text-3xl">{card.value}</p>
              <p className="mt-1 text-sm font-semibold text-muted-foreground">{card.label}</p>
            </button>
          );
        })}
      </section>

      <section className="mb-4 rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Bot className="h-5 w-5 text-green-600" />
          <h2 className="text-base font-bold text-card-foreground">বট অ্যাক্টিভিটি</h2>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <div className="rounded-xl bg-green-50 p-3 text-sm font-semibold text-green-800">
            বট আজ {pulseData.botReplies} জনকে উত্তর দিয়েছে ✅
          </div>
          <button
            onClick={() => navigate("/app/inbox?tab=needs_review")}
            className="min-h-12 rounded-xl bg-amber-50 p-3 text-left text-sm font-semibold text-amber-800"
            type="button"
          >
            আপনাকে দেখতে হবে এমন: {pulseData.needsAttention} টি ⚠️
          </button>
        </div>
      </section>

      {pulseData.atRiskCount > 0 && (
        <section className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4">
          <button
            onClick={() => navigate("/app/orders")}
            type="button"
            className="w-full text-left text-sm font-bold text-red-800"
          >
            ⚠️ {pulseData.atRiskCount} জন কাস্টমার ঝুঁকিপূর্ণ - এক্ষুনি দেখুন
          </button>
        </section>
      )}

      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-card-foreground">সর্বশেষ ৫টি অর্ডার</h2>
          <button
            onClick={() => navigate("/app/orders")}
            className="min-h-12 rounded-xl px-3 text-sm font-semibold text-green-600"
            type="button"
          >
            সব দেখুন
          </button>
        </div>

        {pulseData.lastFiveOrders.length === 0 ? (
          <p className="rounded-xl bg-gray-50 p-4 text-sm font-medium text-gray-600">আজকে এখনো কোনো অর্ডার আসেনি।</p>
        ) : (
          <div className="space-y-2">
            {pulseData.lastFiveOrders.map((order) => {
              const firstItem = order.items[0];
              const status = formatOrderStatus(order.status);

              return (
                <button
                  key={order.id}
                  onClick={() => navigate("/app/orders")}
                  type="button"
                  className="w-full rounded-xl border border-border bg-card p-3 text-left"
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-bold text-card-foreground">{order.customerName}</p>
                      <p className="text-sm text-muted-foreground">
                        {firstItem?.productName || "পণ্য উল্লেখ নেই"} · {formatCurrency(Number(order.total) || 0)}
                      </p>
                    </div>
                    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${status.className}`}>
                      {status.label}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <p className="mt-3 text-xs font-medium text-muted-foreground">
          Live update প্রতি 60 সেকেন্ডে {lastUpdatedAt ? `· শেষ আপডেট ${lastUpdatedAt.toLocaleTimeString("bn-BD")}` : ""}
        </p>
      </section>
    </div>
  );
}
