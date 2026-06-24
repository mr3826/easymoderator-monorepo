export type BillingCycle = "monthly" | "yearly";

export interface SubscriptionPlanDefinition {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  /** For per-order billing plans (Partner). monthlyPrice is 0 when this is set. */
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
    comment_auto_reply: boolean;
  };
  highlights: string[];
  popular?: boolean;
}

// -1 means unlimited
export const UNLIMITED = -1;

export const subscriptionPlans: SubscriptionPlanDefinition[] = [
  {
    id: "growth",
    name: "Growth",
    description:
      "আপনার সম্পূর্ণ AI সেলস টিম — একটাই সহজ দাম। ১৪ দিন ফ্রি ট্রায়াল, কার্ড লাগবে না।",
    monthlyPrice: 999,
    yearlyPrice: 9990, // ~2 months free
    // 300 is the hidden fair-use cap (+50 grace buffer) enforced server-side; it
    // is intentionally NOT the headline. The in-app usage meter shows it; the
    // marketing surface frames it as fair-use with top-ups.
    limits: {
      conversations: 300,
      orders: UNLIMITED,
      products: UNLIMITED,
    },
    features: {
      image_understanding: true,
      advanced_ai: true,
      priority_support: true,
      custom_branding: true,
      comment_auto_reply: true,
    },
    highlights: [
      "সব ফিচার আনলিমিটেড — কোনো লক নেই",
      "Facebook AI Inbox",
      "Advanced RTO Shield + Analytics",
      "Broadcast + Campaign + ভয়েস/ছবি বোঝে",
      "১৪ দিন ফ্রি ট্রায়াল — কার্ড ছাড়াই",
    ],
    popular: true,
  },
  {
    id: "partner",
    name: "Partner",
    description: "মাসে ৩০০+ অর্ডার আছে? আমাদের পার্টনার হোন।",
    monthlyPrice: 0,
    yearlyPrice: 0,
    // Entry per-order rate. Backend bills on a tiered scale (15/12/10 BDT by
    // monthly delivered-order volume — see PARTNER_ORDER_TIERS); the headline
    // shows the entry rate and the highlights convey the ৳10–15 range.
    perOrderChargeBdt: 15,
    limits: {
      conversations: UNLIMITED,
      orders: UNLIMITED,
      products: UNLIMITED,
    },
    features: {
      image_understanding: true,
      advanced_ai: true,
      priority_support: true,
      custom_branding: true,
      comment_auto_reply: true,
    },
    highlights: [
      "মাত্র ৳10–15/ডেলিভার্ড অর্ডার",
      "কোনো মাসিক ফি নেই",
      "Unlimited কথোপকথন",
      "সব চ্যানেল আনলিমিটেড",
      "ডেডিকেটেড সাপোর্ট ম্যানেজার",
    ],
  },
];

export const findPlanByName = (name: string) =>
  subscriptionPlans.find(
    (plan) => plan.name.toLowerCase() === name.toLowerCase()
  );

/** Match by plan code (e.g. "PACKAGE_1" → Package 1 plan). */
export const findPlanByCode = (code: string) =>
  subscriptionPlans.find(
    (plan) => plan.id.toLowerCase() === code.toLowerCase()
  );

export const getPlanPrice = (
  plan: SubscriptionPlanDefinition,
  billingCycle: BillingCycle
) => (billingCycle === "yearly" ? plan.yearlyPrice : plan.monthlyPrice);
