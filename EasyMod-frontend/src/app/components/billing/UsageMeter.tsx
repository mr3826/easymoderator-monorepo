/**
 * UsageMeter — Current conversation usage with animated fill + toast warnings.
 * Extracted from Subscription.tsx (D5 split).
 *
 * - Fills from 0→current% on mount using motion.div width animation.
 * - Toast warnings fire at 80% and 100% via useEffect.
 */
import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface UsageItem {
  used: number;
  limit: number;
  status: "safe" | "warning" | "exceeded";
}

interface UsageMeterProps {
  conversations: UsageItem;
  orders: UsageItem;
  products: UsageItem;
}

function statusColor(status: "safe" | "warning" | "exceeded"): string {
  if (status === "exceeded") return "bg-destructive";
  if (status === "warning") return "bg-yellow-500";
  return "bg-green-500";
}

function pct(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min((used / limit) * 100, 100);
}

function MeterBar({ item, label }: { item: UsageItem; label: string }) {
  const percentage = pct(item.used, item.limit);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-foreground font-medium font-bn">{label}</span>
        <span className="text-muted-foreground">
          {item.used.toLocaleString()} / {item.limit < 0 ? "∞" : item.limit.toLocaleString()}
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${statusColor(item.status)}`}
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.1 }}
        />
      </div>
      <div className="flex justify-between items-center">
        <span className="text-xs text-muted-foreground">{Math.round(percentage)}% used</span>
        {item.status === "exceeded" && (
          <span className="text-xs font-semibold text-destructive font-bn">সীমা পেরিয়েছে</span>
        )}
        {item.status === "warning" && (
          <span className="text-xs font-semibold text-yellow-600 font-bn">সতর্কতা</span>
        )}
      </div>
    </div>
  );
}

export function UsageMeter({ conversations, orders, products }: UsageMeterProps) {
  const { t } = useTranslation();
  const warnedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const { used, limit } = conversations;
    if (limit <= 0) return;
    const p = (used / limit) * 100;

    if (p >= 100 && !warnedRef.current.has(100)) {
      warnedRef.current.add(100);
      toast.error(
        `Conversation limit পূর্ণ হয়েছে (${used}/${limit})। Upgrade করুন।`,
        { duration: 10000, id: "conv-limit-100" }
      );
    } else if (p >= 80 && !warnedRef.current.has(80)) {
      warnedRef.current.add(80);
      toast.warning(
        `Conversation limit-এর ৮০% ব্যবহার হয়েছে (${used}/${limit})।`,
        { duration: 8000, id: "conv-limit-80" }
      );
    }
  }, [conversations.used, conversations.limit]);

  return (
    <div className="bg-card rounded-xl border border-border p-5 space-y-5">
      <h3 className="text-base font-semibold text-foreground font-bn">
        {t("subscription.usageTitle", "এই মাসের ব্যবহার")}
      </h3>
      <MeterBar item={conversations} label={t("subscription.conversations", "Conversations")} />
      <MeterBar item={orders} label={t("subscription.orders", "Orders")} />
      <MeterBar item={products} label={t("subscription.products", "Products")} />
    </div>
  );
}
