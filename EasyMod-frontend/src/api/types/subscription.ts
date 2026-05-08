/**
 * Subscription and Billing types
 */

export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string;
  price_monthly: number;
  price_yearly: number;
  features: string[];
  limits: {
    products?: number;
    orders?: number;
    conversations?: number;
    team_members?: number;
    channels?: number;
  };
}

export interface Subscription {
  id: string;
  shop_id: string;
  plan_id: string;
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid';
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  plan: SubscriptionPlan;
}

export interface PaymentMethod {
  id: string;
  type: 'card' | 'bank_transfer' | 'mobile_money';
  last4?: string;
  brand?: string;
  exp_month?: number;
  exp_year?: number;
}

export interface Invoice {
  id: string;
  subscription_id: string;
  amount_due: number;
  amount_paid: number;
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  created_at: string;
  paid_at?: string;
  pdf_url?: string;
}
