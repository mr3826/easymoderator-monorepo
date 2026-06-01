import { useState, useEffect } from "react";
import { apiClient } from "@/api";
import { findPlanByName, findPlanByCode, type SubscriptionPlanDefinition } from "./subscriptionPlans";

export interface SubscriptionFeatures {
  image_understanding: boolean;
  advanced_ai: boolean;
  priority_support: boolean;
  custom_branding: boolean;
}

interface UseSubscriptionFeaturesResult {
  features: SubscriptionFeatures;
  planName: string;
  plan: SubscriptionPlanDefinition | null;
  loading: boolean;
  error: string | null;
}

// Module-level cache so multiple components don't trigger redundant fetches
let cachedResult: UseSubscriptionFeaturesResult | null = null;
let fetchPromise: Promise<void> | null = null;
let cacheListeners: Array<() => void> = [];

// AI features are available on every package — packages differ only by the
// monthly conversation quota. Fail open so no plan/API state ever locks AI.
const defaultFeatures: SubscriptionFeatures = {
  image_understanding: true,
  advanced_ai: true,
  priority_support: true,
  custom_branding: true,
};

async function fetchAndCache(): Promise<void> {
  try {
    const response = await apiClient.getSubscription();
    if (response.data?.success && response.data?.data?.subscription) {
      const sub = response.data.data.subscription;
      // Try matching by plan name first, then by plan code (e.g. "PACKAGE_1")
      const matched = findPlanByName(sub.plan_name) ?? findPlanByCode(sub.plan_code) ?? null;
      let derivedFeatures: SubscriptionFeatures;
      if (matched?.features) {
        derivedFeatures = {
          image_understanding: matched.features.image_understanding,
          advanced_ai: matched.features.advanced_ai,
          priority_support: matched.features.priority_support,
          custom_branding: matched.features.custom_branding,
        };
      } else if (sub.features && typeof sub.features === "object") {
        // DB features JSONB — cast safely; all paid plans store advanced_ai: true
        const f = sub.features as Record<string, unknown>;
        derivedFeatures = {
          image_understanding: f.image_understanding !== false,
          advanced_ai: f.advanced_ai !== false,
          priority_support: f.priority_support !== false,
          custom_branding: f.custom_branding === true,
        };
      } else {
        // Ultimate fallback: any active subscription gets basic AI
        derivedFeatures = sub.plan_code
          ? { ...defaultFeatures, advanced_ai: true }
          : defaultFeatures;
      }
      cachedResult = {
        features: derivedFeatures,
        planName: sub.plan_name ?? "Growth",
        plan: matched,
        loading: false,
        error: null,
      };
    } else {
      cachedResult = { features: defaultFeatures, planName: "Growth", plan: null, loading: false, error: null };
    }
  } catch (err) {
    console.error('[useSubscriptionFeatures] Failed to fetch subscription features:', err);
    // Fail open: every plan includes all AI features now (Growth + Partner), so
    // granting defaultFeatures on error never locks a shop out of AI.
    cachedResult = { features: defaultFeatures, planName: "Growth", plan: null, loading: false, error: 'Failed to load subscription features' };
  }
  cacheListeners.forEach((cb) => cb());
}

/** Invalidate the module-level cache (call after plan upgrade). */
export function invalidateSubscriptionCache(): void {
  cachedResult = null;
  fetchPromise = null;
}

export function useSubscriptionFeatures(): UseSubscriptionFeaturesResult {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (cachedResult) return; // already resolved
    const cb = () => forceUpdate((n) => n + 1);
    cacheListeners.push(cb);
    if (!fetchPromise) {
      fetchPromise = fetchAndCache();
    }
    return () => {
      cacheListeners = cacheListeners.filter((l) => l !== cb);
    };
  }, []);

  if (cachedResult) return cachedResult;
  return { features: defaultFeatures, planName: "Growth", plan: null, loading: true, error: null };
}
