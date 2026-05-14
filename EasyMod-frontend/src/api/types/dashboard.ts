/**
 * Dashboard and Analytics types
 */

export interface DashboardMetrics {
  metrics: {
    totalMessages: number;
    activeProducts: number;
    ordersToday: number;
    ordersInPeriod: number;
    conversionRate: number;
    weeklyChange: number;
  };
  period?: number;
  analytics?: {
    total_messages: number;
    llm_calls: number;
    cache_hits: number;
    keyword_matches: number;
    cost_estimate: number;
  } | null;
  channels: {
    active: number;
    total: number;
  };
  chartData: Array<{
    date: string;
    orders: number;
  }>;
}

export interface DashboardQueue {
  unread_count: number;
  pending_payment_count: number;
  ready_to_dispatch_count: number;
  at_risk_orders: Array<{
    id: string;
    customer_name: string;
    customer_phone: string;
    status: string;
    tracking_id: string | null;
  }>;
}

export interface ShopAgent {
  id: string;
  name: string;
  email: string;
  role?: string;
}

export interface ShopAISettings {
  automation_mode: string;
  confidence_threshold: number;
  auto_reply_enabled: boolean;
  max_auto_order_value: number;
  ask_email: boolean;
  primary_language: string;
  required_fields: {
    customer_name: boolean;
    mobile_number: boolean;
    delivery_address: boolean;
    payment_method: boolean;
    email_address: boolean;
    special_instructions: boolean;
  };
  handoff_settings: {
    trigger_keywords: string[];
    notification_channel: string;
    cooldown_minutes: number;
  };
}
