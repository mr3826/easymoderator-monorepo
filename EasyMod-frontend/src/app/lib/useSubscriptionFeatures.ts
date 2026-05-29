import { useState, useEffect } from "react";
import { apiClient } from "@/api";
import { findPlanByName, type SubscriptionPlanDefinition } from "./subscriptionPlans";

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

const defaultFeatures: SubscriptionFeatures = {
  image_understanding: false,
  advanced_ai: false,
  priority_support: false,
  custom_branding: false,
};

async function fetchAndCache(): Promise<void> {
  try {
    const response = await apiClient.getSubscription();
    if (response.data?.success && response.data?.data?.subscription) {
      const sub = response.data.data.subscription;
      const matched = findPlanByName(sub.plan_name) ?? null;
      cachedResult = {
        features: matched?.features
          ? {
              image_understanding: matched.features.image_understanding,
              advanced_ai: matched.features.advanced_ai,
              priority_support: matched.features.priority_support,
              custom_branding: matched.features.custom_branding,
            }
          : (sub.features as SubscriptionFeatures) ?? defaultFeatures,
        planName: sub.plan_name ?? "Free",
        plan: matched,
        loading: false,
        error: null,
      };
    } else {
      cachedResult = { features: defaultFeatures, planName: "Free", plan: null, loading: false, error: null };
    }
  } catch (err) {
    console.error('[useSubscriptionFeatures] Failed to fetch subscription features:', err);
    // Safe fallback: keep PACKAGE_1/default limits — do NOT grant PACKAGE_2 features on error
    cachedResult = { features: defaultFeatures, planName: "Free", plan: null, loading: false, error: 'Failed to load subscription features' };
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
  return { features: defaultFeatures, planName: "Free", plan: null, loading: true, error: null };
}
