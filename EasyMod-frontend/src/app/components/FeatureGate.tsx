import { useState, type ReactNode } from "react";
import { Lock, Zap, X } from "lucide-react";
import { useSubscriptionFeatures, type SubscriptionFeatures } from "@/app/lib/useSubscriptionFeatures";
import { subscriptionPlans } from "@/app/lib/subscriptionPlans";
import { useNavigate } from "react-router-dom";

interface UpgradeModalProps {
  featureLabel: string;
  requiredPlan: string;
  onClose: () => void;
}

function UpgradeModal({ featureLabel, requiredPlan, onClose }: UpgradeModalProps) {
  const navigate = useNavigate();
  const plan = subscriptionPlans.find((p) => p.name === requiredPlan);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 relative animate-in fade-in zoom-in-95 duration-150">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center justify-center w-14 h-14 rounded-full bg-amber-100 mx-auto mb-4">
          <Lock className="w-7 h-7 text-amber-600" />
        </div>

        <h2 className="text-xl font-bold text-gray-900 text-center mb-1">
          Upgrade to unlock
        </h2>
        <p className="text-gray-500 text-center text-sm mb-5">
          <strong className="text-gray-700">{featureLabel}</strong> is available on the{" "}
          <span className="font-semibold text-blue-600">{requiredPlan}</span> plan and above.
        </p>

        {plan && (
          <div className="bg-blue-50 rounded-xl p-4 mb-5 border border-blue-100">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-gray-900">{plan.name} Plan</span>
              <span className="font-bold text-blue-700">৳{plan.monthlyPrice.toLocaleString()}/mo</span>
            </div>
            <ul className="space-y-1">
              {plan.highlights.slice(0, 3).map((h) => (
                <li key={h} className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                  {h}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Not now
          </button>
          <button
            onClick={() => { onClose(); navigate("/app/subscription"); }}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            <Zap className="w-4 h-4" />
            Upgrade now
          </button>
        </div>
      </div>
    </div>
  );
}

interface FeatureGateProps {
  /** The feature flag key to check */
  feature: keyof SubscriptionFeatures;
  /** Human-readable label shown in the upgrade modal */
  featureLabel: string;
  /** Minimum plan name required (e.g. "Growth") */
  requiredPlan: string;
  children: ReactNode;
}

/**
 * Wraps children with a soft lock overlay when the current plan does not
 * include the feature. Clicking the overlay opens an upgrade modal.
 *
 * Usage:
 *   <FeatureGate feature="image_understanding" featureLabel="Image Understanding" requiredPlan="Growth">
 *     <ImageUploader />
 *   </FeatureGate>
 */
export function FeatureGate({ feature, featureLabel, requiredPlan, children }: FeatureGateProps) {
  const { features, loading } = useSubscriptionFeatures();
  const [showModal, setShowModal] = useState(false);

  // While loading, render children normally (avoid flash of lock)
  if (loading || features[feature]) {
    return <>{children}</>;
  }

  return (
    <>
      <div
        className="relative cursor-pointer select-none"
        onClick={() => setShowModal(true)}
        title={`Upgrade to ${requiredPlan} to unlock ${featureLabel}`}
      >
        {/* Blur overlay */}
        <div className="absolute inset-0 z-10 rounded-lg bg-white/60 backdrop-blur-[2px] flex items-center justify-center">
          <div className="flex items-center gap-1.5 bg-amber-100 text-amber-700 px-3 py-1.5 rounded-full text-sm font-medium shadow-sm">
            <Lock className="w-3.5 h-3.5" />
            <span>Upgrade to {requiredPlan}</span>
          </div>
        </div>
        {/* Render children behind the overlay for layout */}
        <div className="pointer-events-none opacity-40">{children}</div>
      </div>

      {showModal && (
        <UpgradeModal
          featureLabel={featureLabel}
          requiredPlan={requiredPlan}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}
