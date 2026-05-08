/**
 * Audit Log types
 */

export type AuditAction = 
  | 'CREATE' | 'UPDATE' | 'DELETE' 
  | 'LOGIN' | 'LOGOUT' 
  | 'CHANNEL_CONNECT' | 'CHANNEL_DISCONNECT' 
  | 'ORDER_CONFIRM' | 'ORDER_CANCEL' 
  | 'PAYMENT_PROCESS' | 'EXPORT_DATA' 
  | 'DASHBOARD_ACCESS' 
  | 'HUMAN_TAKEOVER' 
  | 'AI_SUGGESTION_ACCEPTED' | 'AI_SUGGESTION_REJECTED';

export type AuditResourceType = 
  | 'USER' | 'SHOP' | 'CHANNEL' | 'CUSTOMER' 
  | 'PRODUCT' | 'ORDER' | 'CATEGORY' 
  | 'CONVERSATION' | 'MESSAGE' | 'PAYMENT' | 'DASHBOARD';

export interface AuditLog {
  id: string;
  user_id: string;
  shop_id: string;
  action: AuditAction;
  resource_type: AuditResourceType;
  resource_id: string;
  old_values?: unknown;
  new_values?: unknown;
  metadata?: unknown;
  ip_address?: string;
  user_agent?: string;
  idempotency_key?: string;
  created_at: string;
  user?: {
    id: string;
    email: string;
    full_name: string;
  };
}

export interface AuditLogFilters {
  userId?: string;
  action?: string;
  resourceType?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}
