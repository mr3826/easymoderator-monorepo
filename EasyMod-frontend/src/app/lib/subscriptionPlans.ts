export type BillingCycle = "monthly" | "yearly";

export interface SubscriptionPlanDefinition {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  /** For per-order billing plans (Partner). monthlyPrice is 0 when this is set. */
  perOrderChargeBdt?: number;
  maxChannels: number; // -1 = unlimited
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
    id: "starter",
    name: "Starter",
    description: "আপনার প্রথম AI সেলস টিম — ঘুমের মধ্যেও অর্ডার আসবে।",
    monthlyPrice: 750,
    yearlyPrice: 7500,
    maxChannels: 1,
    limits: {
      conversations: UNLIMITED,
      orders: UNLIMITED,
      products: UNLIMITED,
    },
    features: {
      image_understanding: false,
      advanced_ai: false,
      priority_support: false,
      custom_branding: false,
      comment_auto_reply: false,
    },
    highlights: [
      "AI Inbox + RTO Shield",
      "Unlimited conversation",
      "1 Facebook চ্যানেল",
      "গ্রাহক যাত্রা ট্র্যাক করুন",
      "Basic RTO Shield",
    ],
    popular: false,
  },
  {
    id: "growth",
    name: "Growth",
    description: "সব চ্যানেলে 500+ অর্ডার পরিচালনা করুন প্রতি সপ্তাহে।",
    monthlyPrice: 1950,
    yearlyPrice: 19500,
    maxChannels: 3,
    limits: {
      conversations: UNLIMITED,
      orders: UNLIMITED,
      products: UNLIMITED,
    },
    features: {
      image_understanding: true,
      advanced_ai: true,
      priority_support: true,
      custom_branding: false,
      comment_auto_reply: true,
    },
    highlights: [
      "Auto-Reply + Broadcast",
      "Unlimited conversation",
      "3টি চ্যানেল (FB, IG)",
      "Advanced RTO Shield",
      "বিস্তৃত Analytics",
    ],
    popular: true,
  },
  {
    id: "partner",
    name: "Partner",
    description: "মাসে ৩০০+ অর্ডার আছে? আমাদের পার্টনার হোন।",
    monthlyPrice: 0,
    yearlyPrice: 0,
    perOrderChargeBdt: 22,
    maxChannels: UNLIMITED,
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
      "মাত্র ৳22/ডেলিভার্ড অর্ডার",
      "কোনো মাসিক ফি নেই",
      "Unlimited conversation",
      "সব চ্যানেল আনলিমিটেড",
      "ডেডিকেটেড সাপোর্ট ম্যানেজার",
    ],
  },
];

export const findPlanByName = (name: string) =>
  subscriptionPlans.find(
    (plan) => plan.name.toLowerCase() === name.toLowerCase()
  );

export const getPlanPrice = (
  plan: SubscriptionPlanDefinition,
  billingCycle: BillingCycle
) => (billingCycle === "yearly" ? plan.yearlyPrice : plan.monthlyPrice);
