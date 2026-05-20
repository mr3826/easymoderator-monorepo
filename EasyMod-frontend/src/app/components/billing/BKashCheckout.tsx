/**
 * BKashCheckout — bKash payment flow for conversation pack purchases.
 * Extracted from Subscription.tsx (D5 split).
 *
 * Shows a "Test mode" banner when VITE_BKASH_SANDBOX=true.
 * Pricing copy uses "750 BDT/month" plain text (no ৳ glyph) to avoid
 * ambiguity when UI language is toggled to English.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/api";

const IS_SANDBOX = import.meta.env.VITE_BKASH_SANDBOX === "true" ||
  import.meta.env.VITE_ENV === "development" ||
  import.meta.env.DEV;

interface ConversationPack {
  amount: number;
  price: number;
}

const CONVERSATION_PACKS: ConversationPack[] = [
  { amount: 100, price: 250 },
  { amount: 300, price: 675 },
  { amount: 500, price: 1000 },
];

interface BKashCheckoutProps {
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
}

export function BKashCheckout({ onSuccess, onError }: BKashCheckoutProps) {
  const { t } = useTranslation();
  const [selectedPack, setSelectedPack] = useState<number | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);

  const handleRequestInvoice = async () => {
    if (!selectedPack) return;
    const pack = CONVERSATION_PACKS.find((p) => p.amount === selectedPack);
    if (!pack) return;

    try {
      setIsRequesting(true);
      const invoiceRes = await apiClient.purchaseConversationPack({
        amount: selectedPack,
        price: pack.price,
      });

      if (!invoiceRes.success || !invoiceRes.data?.id) {
        throw new Error(invoiceRes.message || "Failed to create invoice");
      }

      const msg = `Invoice created (${invoiceRes.data.invoice_number || ""}). Please pay ${pack.price.toLocaleString()} BDT via bKash and contact support@easymod.ai to activate your pack.`;
      onSuccess?.(msg);
      toast.success(msg, { duration: 10000 });
      setSelectedPack(null);
    } catch (err: unknown) {
      const errMsg =
        (err as { response?: { data?: { error?: { message?: string } } }; message?: string })
          ?.response?.data?.error?.message ||
        (err as { message?: string })?.message ||
        "Failed to create invoice";
      onError?.(errMsg);
      toast.error(errMsg);
    } finally {
      setIsRequesting(false);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground font-bn">
          {t("subscription.buyConvPack", "Conversation Pack কিনুন")}
        </h3>
        {/* Test mode banner */}
        {IS_SANDBOX && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
            <AlertTriangle className="w-3 h-3" />
            Test mode
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground font-bn">
        {t("subscription.convPackHint", "Extra conversation এর জন্য pack কিনুন। Invoice তৈরি হবে, payment দিলে activate হবে।")}
      </p>

      <div className="grid grid-cols-3 gap-3">
        {CONVERSATION_PACKS.map((pack) => (
          <button
            key={pack.amount}
            onClick={() => setSelectedPack(pack.amount === selectedPack ? null : pack.amount)}
            className={[
              "rounded-xl border-2 p-4 text-center transition-all",
              selectedPack === pack.amount
                ? "border-primary bg-primary/5 shadow-sm"
                : "border-border bg-background hover:border-primary/40",
            ].join(" ")}
          >
            <p className="text-lg font-bold text-foreground">{pack.amount}</p>
            <p className="text-xs text-muted-foreground mb-2 font-bn">conversations</p>
            <p className="text-sm font-semibold text-primary">
              {pack.price.toLocaleString()} BDT
            </p>
          </button>
        ))}
      </div>

      <button
        onClick={handleRequestInvoice}
        disabled={!selectedPack || isRequesting}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-pink-600 text-white font-semibold text-sm hover:bg-pink-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-bn"
      >
        {isRequesting && <Loader2 className="w-4 h-4 animate-spin" />}
        {t("subscription.requestInvoice", "Invoice তৈরি করুন (bKash)")}
      </button>

      {IS_SANDBOX && (
        <p className="text-xs text-center text-amber-700 font-bn">
          Test mode: কোনো real payment হবে না।
        </p>
      )}
    </div>
  );
}
