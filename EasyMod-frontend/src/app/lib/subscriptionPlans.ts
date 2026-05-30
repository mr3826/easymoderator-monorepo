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
    id: "free",
    name: "Free",
    description: "বিনামূল্যে শুরু করুন — কার্ড লাগবে না। AI আপনার পেজে অটো-রিপ্লাই দেবে।",
    monthlyPrice: 0,
    yearlyPrice: 0,
    limits: {
      conversations: 50,
      orders: UNLIMITED,
      products: 30,
    },
    features: {
      image_understanding: false,
      advanced_ai: false,
      priority_support: false,
      custom_branding: false,
      comment_auto_reply: true,
    },
    highlights: [
      "৫০ AI কথোপকথন/মাস — ফ্রি",
      "Facebook + Instagram",
      "Comment অটো-রিপ্লাই",
      "বাংলা ও Banglish AI",
      "কার্ড ছাড়াই শুরু",
    ],
    popular: false,
  },
  {
    id: "package_1",
    name: "Package 1",
    description: "আপনার প্রথম AI সেলস টিম — ঘুমের মধ্যেও অর্ডার আসবে।",
    monthlyPrice: 750,
    yearlyPrice: 7500,
    limits: {
      conversations: 500,
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
      "AI Inbox — ৫০০ কথোপকথন/মাস",
      "সব চ্যানেল (FB, IG)",
      "RTO Shield",
      "গ্রাহক যাত্রা ট্র্যাক করুন",
      "7 দিনের Analytics",
    ],
    popular: false,
  },
  {
    id: "package_2",
    name: "Package 2",
    description: "সব চ্যানেলে ৫০০+ অর্ডার পরিচালনা করুন প্রতি সপ্তাহে।",
    monthlyPrice: 1950,
    yearlyPrice: 19500,
    limits: {
      conversations: 1500,
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
      "Full AI Inbox — ১৫০০ কথোপকথন/মাস",
      "সব চ্যানেল আনলিমিটেড",
      "Advanced RTO Shield",
      "৩০ দিনের Analytics + Export",
      "Broadcast + Campaign",
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
