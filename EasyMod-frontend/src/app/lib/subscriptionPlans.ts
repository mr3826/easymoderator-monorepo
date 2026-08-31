export type BillingCycle = "monthly" | "yearly";
export type PlanCode = "SHURU" | "GROWTH" | "PARTNER";

export interface PartnerOrderTier {
  minOrders: number;
  maxOrders: number | null;
  rateBdt: number;
}

export interface TopupPackDefinition {
  code: string;
  conversations: number;
  priceBdt: number;
}

export interface SubscriptionPlanDefinition {
  id: string;
  code: PlanCode;
  name: string;
  description: string;
  billingModel: "flat_monthly" | "per_order";
  monthlyPrice: number;
  yearlyPrice: number;
  canPurchaseTopups: boolean;
  /** For per-order billing plans (Partner). */
  perOrderChargeBdt?: number;
  limits: {
    conversations: number; // -1 = unlimited
    orders: number;
    products: number;
  };
  features: {
    image_understanding: boolean;
    advanced_ai: boolean;
    priority_support: boolean;
    custom_branding: boolean;
    messenger_dm_only: boolean;
  };
  highlights: string[];
  topupPacks?: TopupPackDefinition[];
  partnerOrderTiers?: PartnerOrderTier[];
  popular?: boolean;
}

export interface PublicSubscriptionPlanPayload {
  code: PlanCode;
  name: string;
  description: string;
  billing_model: "flat_monthly" | "per_order";
  price_bdt_monthly: number;
  price_bdt_yearly: number;
  conversations_limit: number;
  orders_limit: number;
  products_limit: number;
  can_purchase_topups: boolean;
  per_order_charge_bdt: number | null;
  features?: Record<string, unknown>;
  topup_packs?: TopupPackDefinition[];
  partner_order_tiers?: PartnerOrderTier[];
}

export const UNLIMITED = -1;

const SHARED_FEATURES = {
  image_understanding: true,
  advanced_ai: true,
  priority_support: true,
  custom_branding: true,
  messenger_dm_only: true,
};

export const TOPUP_PACK_FALLBACK: TopupPackDefinition[] = [
  { code: "PACK_100", conversations: 100, priceBdt: 250 },
  { code: "PACK_300", conversations: 300, priceBdt: 500 },
  { code: "PACK_700", conversations: 700, priceBdt: 1000 },
];

export const PARTNER_ORDER_TIERS_FALLBACK: PartnerOrderTier[] = [
  { minOrders: 300, maxOrders: 999, rateBdt: 15 },
  { minOrders: 1000, maxOrders: 2999, rateBdt: 12 },
  { minOrders: 3000, maxOrders: null, rateBdt: 10 },
];

export function publicPlanToDefinition(
  plan: PublicSubscriptionPlanPayload,
): SubscriptionPlanDefinition {
  const fallback = subscriptionPlans.find((item) => item.code === plan.code);
  const features = plan.features || {};
  return {
    id: plan.code.toLowerCase(),
    code: plan.code,
    name: plan.name,
    description: plan.description,
    billingModel: plan.billing_model,
    monthlyPrice: Number(plan.price_bdt_monthly),
    yearlyPrice: Number(plan.price_bdt_yearly),
    canPurchaseTopups: plan.can_purchase_topups,
    perOrderChargeBdt: plan.per_order_charge_bdt ?? undefined,
    limits: {
      conversations: plan.conversations_limit,
      orders: plan.orders_limit,
      products: plan.products_limit,
    },
    features: {
      image_understanding: features.image_understanding === true,
      advanced_ai: features.advanced_ai === true,
      priority_support: features.priority_support === true,
      custom_branding: features.custom_branding !== false,
      messenger_dm_only: true,
    },
    highlights: fallback?.highlights || [],
    topupPacks: plan.topup_packs,
    partnerOrderTiers: plan.partner_order_tiers,
    popular: plan.code === "GROWTH",
  };
}

/**
 * Small offline fallback for the public plan request. Keep these values pinned
 * to the backend catalog so a temporarily unavailable API cannot display a
 * different commercial model.
 */
export const subscriptionPlans: SubscriptionPlanDefinition[] = [
  {
    id: "shuru",
    code: "SHURU",
    name: "Shuru",
    description: "Free forever for getting started with Messenger sales.",
    billingModel: "flat_monthly",
    monthlyPrice: 0,
    yearlyPrice: 0,
    canPurchaseTopups: false,
    limits: { conversations: 100, orders: UNLIMITED, products: UNLIMITED },
    features: SHARED_FEATURES,
    highlights: [
      "100 customer conversations each month",
      "Facebook Messenger inbox",
      "Order capture and COD risk checks",
      "Manual replies always available",
    ],
  },
  {
    id: "growth",
    code: "GROWTH",
    name: "Growth",
    description: "The full Messenger sales assistant for growing shops.",
    billingModel: "flat_monthly",
    monthlyPrice: 999,
    yearlyPrice: 9990,
    canPurchaseTopups: true,
    limits: { conversations: 500, orders: UNLIMITED, products: UNLIMITED },
    features: SHARED_FEATURES,
    highlights: [
      "500 customer conversations each month",
      "Facebook Messenger inbox",
      "Order capture and COD risk checks",
      "Top-ups when you need more conversations",
    ],
    topupPacks: TOPUP_PACK_FALLBACK,
    popular: true,
  },
  {
    id: "partner",
    code: "PARTNER",
    name: "Partner",
    description: "No upfront fee; pay for successfully delivered orders.",
    billingModel: "per_order",
    monthlyPrice: 0,
    yearlyPrice: 0,
    canPurchaseTopups: false,
    limits: { conversations: UNLIMITED, orders: UNLIMITED, products: UNLIMITED },
    features: SHARED_FEATURES,
    highlights: [
      "300+ delivered orders in 30 days to qualify",
      "No monthly fee",
      "Unlimited customer conversations",
      "Flat rate by delivered-order band",
    ],
    partnerOrderTiers: PARTNER_ORDER_TIERS_FALLBACK,
  },
];

export const findPlanByName = (name: string) =>
  subscriptionPlans.find(
    (plan) => plan.name.toLowerCase() === name.toLowerCase(),
  );

export const findPlanByCode = (code: string) => {
  const normalized = code.toUpperCase();
  return subscriptionPlans.find(
    (plan) => plan.code === normalized || plan.id.toUpperCase() === normalized,
  );
};

export const getPlanPrice = (
  plan: SubscriptionPlanDefinition,
  billingCycle: BillingCycle,
) => (billingCycle === "yearly" ? plan.yearlyPrice : plan.monthlyPrice);
