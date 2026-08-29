import { useEffect, useState } from "react";
import { apiClient } from "@/api";
import { authService } from "@/app/lib/auth";
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

const lockedFeatures: SubscriptionFeatures = {
  image_understanding: false,
  advanced_ai: false,
  priority_support: false,
  custom_branding: false,
};

const cache = new Map<string, UseSubscriptionFeaturesResult>();
const inFlight = new Map<string, Promise<void>>();
const listeners = new Map<string, Set<() => void>>();

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

async function fetchAndCache(shopId: string): Promise<void> {
  try {
    const rawSubscription = await apiClient.getSubscription();
    const sub = normalizeSubscription(rawSubscription);
    if (!sub) throw new Error("Subscription entitlement data is unavailable");

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

    const derivedFeatures = matched?.features
      ? asFeatureSet(matched.features)
      : isRecord(sub.features)
        ? asFeatureSet(sub.features)
        : null;
    if (!derivedFeatures) throw new Error("Subscription entitlement data is incomplete");

    cache.set(shopId, {
      features: derivedFeatures,
      planName: planName ?? "Shuru",
      plan: matched,
      loading: false,
      error: null,
    });
  } catch (error) {
    console.error("[useSubscriptionFeatures] Failed to fetch subscription features:", error);
    cache.set(shopId, {
      features: lockedFeatures,
      planName: "Unavailable",
      plan: null,
      loading: false,
      error: "Failed to load subscription features",
    });
  }
  listeners.get(shopId)?.forEach((listener) => listener());
}

/** Invalidate all tenant-scoped entries (call after plan upgrade or switch). */
export function invalidateSubscriptionCache(shopId?: string): void {
  if (shopId) {
    cache.delete(shopId);
    inFlight.delete(shopId);
    return;
  }
  cache.clear();
  inFlight.clear();
}

export function useSubscriptionFeatures(): UseSubscriptionFeaturesResult {
  const shopId = authService.getCurrentShopId() || "unknown";
  const [, forceUpdate] = useState(0);
  const cachedResult = cache.get(shopId);

  useEffect(() => {
    if (cache.has(shopId)) return;
    const listener = () => forceUpdate((value) => value + 1);
    const shopListeners = listeners.get(shopId) || new Set<() => void>();
    shopListeners.add(listener);
    listeners.set(shopId, shopListeners);
    if (!inFlight.has(shopId)) {
      const request = fetchAndCache(shopId).finally(() => inFlight.delete(shopId));
      inFlight.set(shopId, request);
    }
    return () => {
      shopListeners.delete(listener);
      if (shopListeners.size === 0) listeners.delete(shopId);
    };
  }, [forceUpdate, shopId]);

  return cachedResult || {
    features: lockedFeatures,
    planName: "Loading",
    plan: null,
    loading: true,
    error: null,
  };
}
