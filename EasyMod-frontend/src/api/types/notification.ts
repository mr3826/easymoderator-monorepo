export interface NotificationEventPreference {
  eventType: string;
  label: string;
  labelBn: string;
  enabled: boolean;
}

export interface TelegramNotificationStatus {
  configured: boolean;
  botUsername: string | null;
  suggestedGroupName: string;
  status: 'disconnected' | 'pending' | 'connected' | 'unhealthy' | string;
  enabled: boolean;
  connected: boolean;
  chatTitle: string | null;
  chatType: string | null;
  lastError: string | null;
  lastTestedAt: string | null;
  lastSentAt: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  connectionExpiresAt: string | null;
  preferences: Record<string, boolean>;
  events: NotificationEventPreference[];
  pendingCommand?: string | null;
  instructions?: string[];
  expiresAt?: string;
}

export interface OwnerNotification {
  id: string;
  shop_id: string;
  type: string;
  customer_message?: string | null;
  customer_data?: {
    title?: string;
    deepLink?: string;
    [key: string]: unknown;
  } | null;
  status: 'pending' | 'completed' | 'expired' | string;
  created_at?: string;
  updated_at?: string;
  createdAt?: string;
  updatedAt?: string;
}
