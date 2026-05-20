/**
 * PlanComparison — Three-tier plan card grid.
 * Extracted from Subscription.tsx (D5 split).
 *
 * - cardHover on each plan card.
 * - Selected plan has primary-colored border + checkmark badge.
 * - Pricing copy uses plain "750 BDT/month" text (no ৳ glyph ambiguity).
 */
import { motion } from "motion/react";
import { Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { subscriptionPlans, getPlanPrice, type BillingCycle } from "@/app/lib/subscriptionPlans";
import { cardHover } from "@/lib/motion";
import { Switch } from "@/app/components/ui/switch";

interface PlanComparisonProps {
  selectedPlanId: string;
  billingCycle: BillingCycle;
  currentPlanName: string;
  isUpdating: boolean;
  onSelectPlan: (planId: string) => void;
  onBillingCycleChange: (cycle: BillingCycle) => void;
  onConfirmPlan: (planId: string) => void;
}

export function PlanComparison({
  selectedPlanId,
  billingCycle,
  currentPlanName,
  isUpdating,
  onSelectPlan,
  onBillingCycleChange,
  onConfirmPlan,
}: PlanComparisonProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-5">
      {/* Billing cycle toggle */}
      <div className="flex items-center gap-3 text-sm">
        <span className={`font-medium ${billingCycle === "monthly" ? "text-foreground" : "text-muted-foreground"}`}>
          {t("subscription.monthly", "Monthly")}
        </span>
        <Switch
          checked={billingCycle === "yearly"}
          onCheckedChange={(checked) => onBillingCycleChange(checked ? "yearly" : "monthly")}
          aria-label="Toggle annual billing"
        />
        <span className={`font-medium ${billingCycle === "yearly" ? "text-foreground" : "text-muted-foreground"}`}>
          {t("subscription.yearly", "Yearly")}
        </span>
        {billingCycle === "yearly" && (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
            2 months free
          </span>
        )}
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {subscriptionPlans.map((plan) => {
          const isSelected = plan.id === selectedPlanId;
          const isCurrent = plan.name.toLowerCase() === currentPlanName.toLowerCase();
          const price = getPlanPrice(plan, billingCycle);

          return (
            <motion.div
              key={plan.id}
              onClick={() => onSelectPlan(plan.id)}
              whileHover={!isSelected ? cardHover : undefined}
              className={[
                "relative rounded-2xl border-2 p-5 cursor-pointer transition-colors",
                isSelected
                  ? "border-primary bg-primary/5 shadow-md"
                  : "border-border bg-card hover:border-primary/40",
              ].join(" ")}
            >
              {/* Selected checkmark badge */}
              {isSelected && (
                <div className="absolute -top-2.5 -right-2.5 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow">
                  <Check className="w-3.5 h-3.5" />
                </div>
              )}

              {plan.popular && (
                <span className="absolute -top-3 left-4 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-primary text-primary-foreground shadow">
                  {t("subscription.popular", "Popular")}
                </span>
              )}

              <div className="mb-3">
                <p className="text-base font-bold text-foreground">{plan.name}</p>
                {isCurrent && (
                  <span className="text-xs font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-md mt-0.5 inline-block font-bn">
                    {t("subscription.currentPlan", "Current plan")}
                  </span>
                )}
              </div>

              {/* Price — plain BDT text, no ৳ glyph */}
              <div className="mb-4">
                {price === 0 ? (
                  <p className="text-2xl font-extrabold text-foreground font-bn">Free</p>
                ) : plan.perOrderChargeBdt ? (
                  <>
                    <p className="text-2xl font-extrabold text-foreground">
                      {plan.perOrderChargeBdt} BDT
                    </p>
                    <p className="text-xs text-muted-foreground font-bn">/order</p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-extrabold text-foreground">
                      {price.toLocaleString()} BDT
                    </p>
                    <p className="text-xs text-muted-foreground font-bn">
                      /month{billingCycle === "yearly" ? " (billed yearly)" : ""}
                    </p>
                  </>
                )}
              </div>

              <ul className="space-y-1.5 text-xs text-muted-foreground">
                {plan.highlights.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">✓</span>
                    <span className="font-bn">{feature}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          );
        })}
      </div>

      {/* Confirm button */}
      <button
        onClick={() => onConfirmPlan(selectedPlanId)}
        disabled={isUpdating}
        className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-60 font-bn"
      >
        {isUpdating && <Loader2 className="w-4 h-4 animate-spin" />}
        {t("subscription.confirmPlan", "Plan পরিবর্তন করুন")}
      </button>
    </div>
  );
}
