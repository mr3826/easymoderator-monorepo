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

const lockedFeatures: SubscriptionFeatures = {
  image_understanding: false,
  advanced_ai: false,
  priority_support: false,
  custom_branding: false,
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === "object" && !Array.isArray(value)
);

const normalizeSubscription = (value: unknown): Record<string, unknown> | null => {
  if (!isRecord(value)) return null;
  if (Object.prototype.hasOwnProperty.call(value, "subscription")) {
    return isRecord(value.subscription) ? value.subscription : null;
  }
  return value;
};

const asFeatureSet = (value: Record<string, unknown>): SubscriptionFeatures => ({
  image_understanding: value.image_understanding === true,
  advanced_ai: value.advanced_ai === true,
  priority_support: value.priority_support === true,
  custom_branding: value.custom_branding === true,
});

async function fetchAndCache(): Promise<void> {
  try {
    const rawSubscription = await apiClient.getSubscription();
    const sub = normalizeSubscription(rawSubscription);
    if (sub) {
      // Try matching by plan name first, then by plan code (e.g. "PACKAGE_1")
      const planValue = sub.plan;
      const planName = typeof sub.plan_name === "string"
        ? sub.plan_name
        : isRecord(planValue) && typeof planValue.name === "string"
          ? planValue.name
          : undefined;
      const planCode = typeof sub.plan_code === "string"
        ? sub.plan_code
        : typeof planValue === "string" ? planValue : undefined;
      const matched =
        (planName ? findPlanByName(planName) : undefined) ??
        (planCode ? findPlanByCode(planCode) : undefined) ??
        null;
      let derivedFeatures: SubscriptionFeatures;
      if (matched?.features) {
        derivedFeatures = asFeatureSet(matched.features);
      } else if (isRecord(sub.features)) {
        derivedFeatures = asFeatureSet(sub.features);
      } else {
        throw new Error("Subscription entitlement data is incomplete");
      }
      cachedResult = {
        features: derivedFeatures,
        planName: planName ?? "Growth",
        plan: matched,
        loading: false,
        error: null,
      };
    } else {
      throw new Error("Subscription entitlement data is unavailable");
    }
  } catch (err) {
    console.error('[useSubscriptionFeatures] Failed to fetch subscription features:', err);
    cachedResult = {
      features: lockedFeatures,
      planName: "Unavailable",
      plan: null,
      loading: false,
      error: 'Failed to load subscription features'
    };
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
  return { features: lockedFeatures, planName: "Loading", plan: null, loading: true, error: null };
}
