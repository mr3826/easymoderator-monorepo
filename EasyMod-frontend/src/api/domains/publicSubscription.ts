import type { ApiResponse } from "../types/common";
import { publicApiGet } from "@/shared/lib/http/public-client";
import {
  publicPlanToDefinition,
  subscriptionPlans,
  type PublicSubscriptionPlanPayload,
  type SubscriptionPlanDefinition,
} from "@/app/lib/subscriptionPlans";

export type PublicSubscriptionCatalogSource = "live" | "fallback";

export interface PublicSubscriptionCatalog {
  plans: SubscriptionPlanDefinition[];
  source: PublicSubscriptionCatalogSource;
}

/** Fetch only the server-published catalog for public pricing surfaces. */
export async function getCurrentPublicSubscriptionCatalog(): Promise<PublicSubscriptionCatalog> {
  const response = await publicApiGet<ApiResponse<PublicSubscriptionPlanPayload[]>>(
    "/api/subscription/plans",
  );
  if (!Array.isArray(response.data) || response.data.length === 0) {
    throw new Error("The public subscription catalog is unavailable.");
  }
  return { plans: response.data.map(publicPlanToDefinition), source: "live" };
}

export async function getPublicSubscriptionCatalog(): Promise<PublicSubscriptionCatalog> {
  try {
    const response = await publicApiGet<ApiResponse<PublicSubscriptionPlanPayload[]>>(
      "/api/subscription/plans",
    );
    if (Array.isArray(response.data) && response.data.length > 0) {
      return { plans: response.data.map(publicPlanToDefinition), source: "live" };
    }
  } catch {
    // The static values are deliberately small and pinned to the backend model.
  }
  return { plans: subscriptionPlans, source: "fallback" };
}
