/**
 * OrderRow — Single order card row.
 * Extracted from Orders.tsx (D3 split).
 *
 * Dispatch button uses cardHover lift.
 * Status pills use semantic design tokens where possible.
 */
import { motion } from "motion/react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Order } from "@/api/types/order";
import { cardHover } from "@/lib/motion";

// Semantic token-aligned status pill classes
const STATUS_CLASSES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  confirmed: "bg-blue-100 text-blue-700",
  processing: "bg-yellow-100 text-yellow-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-destructive/10 text-destructive",
};

interface OrderRowProps {
  order: Order;
  formatCurrency: (value: number) => string;
  formatDate: (value: string) => string;
  onViewDetail: (order: Order) => void;
  onDispatch: (order: Order) => void;
}

export function OrderRow({ order, formatCurrency, formatDate, onViewDetail, onDispatch }: OrderRowProps) {
  const { t } = useTranslation();

  const canDispatch =
    !order.delivery_tracking_code &&
    order.status !== "cancelled" &&
    order.status !== "completed";

  return (
    <article className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-bold text-card-foreground font-bn">
            {order.customerName}
          </p>
          <p className="text-xs text-muted-foreground">#{order.id}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${
            STATUS_CLASSES[order.status] ?? "bg-muted text-muted-foreground"
          }`}
        >
          {order.status}
        </span>
      </div>

      <p className="text-sm text-foreground">
        {order.items[0]?.productName || "পণ্য উল্লেখ নেই"} ×{" "}
        {order.items[0]?.quantity || 1} ·{" "}
        <span className="font-bold">{formatCurrency(order.total)}</span>
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-md bg-muted px-2 py-1">📍 {order.channel}</span>
        <span className="rounded-md bg-muted px-2 py-1">🕐 {formatDate(order.createdAt)}</span>
        {order.rto_risk === "high" && (
          <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-1 font-semibold text-red-700 font-bn">
            <AlertTriangle className="h-3 w-3" /> {t("customers.highRTO")}
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          onClick={() => onViewDetail(order)}
          className="min-h-12 rounded-xl border border-border bg-white px-3 text-sm font-semibold text-foreground hover:bg-muted transition-colors font-bn"
        >
          বিস্তারিত দেখুন
        </button>
        {order.delivery_tracking_code ? (
          <a
            href={`https://steadfast.com.bd/track?trackingCode=${order.delivery_tracking_code}`}
            target="_blank"
            rel="noreferrer"
            className="min-h-12 rounded-xl bg-green-600 px-3 text-sm font-semibold text-white flex items-center justify-center hover:bg-green-700 transition-colors font-bn"
          >
            ট্র্যাক করুন
          </a>
        ) : canDispatch ? (
          <motion.button
            onClick={() => onDispatch(order)}
            whileHover={cardHover}
            whileTap={{ scale: 0.96 }}
            className="min-h-12 rounded-xl bg-primary px-3 text-sm font-bold text-primary-foreground shadow-sm font-bn"
          >
            Dispatch
          </motion.button>
        ) : (
          <button
            onClick={() => onViewDetail(order)}
            className="min-h-12 rounded-xl bg-muted px-3 text-sm font-semibold text-muted-foreground font-bn"
          >
            স্ট্যাটাস দেখুন
          </button>
        )}
      </div>
    </article>
  );
}
