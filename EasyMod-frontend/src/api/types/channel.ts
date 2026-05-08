/**
 * Channel and Integration types
 */

export type ChannelStatus = 'active' | 'inactive' | 'error';
export type ChannelPlatform = 'facebook' | 'messenger' | 'instagram' | 'manual';

export interface Channel {
  id: string;
  shop_id?: string;
  name?: string;
  type?: 'facebook' | 'instagram';
  status?: ChannelStatus;
  connected?: boolean;
  config?: unknown;
  last_sync?: string | null;
  message_count?: number;
  created_at?: string;
  updated_at?: string;
  lastSync?: string;
  messageCount?: number;
  channel_type?: string;
}

export interface FacebookPage {
  id: string;
  name: string;
  category: string | null;
  pictureUrl: string | null;
  instagramAccount: { id: string; name: string; username: string } | null;
}

export interface OAuthCallbackResult {
  pages: FacebookPage[];
  tempToken: string;
}

export interface MetaIntegrationStatus {
  platform: 'messenger' | 'instagram';
  connected: boolean;
  display_name: string | null;
  connected_at: string | null;
}

export interface PipelineTestResult {
  success: boolean;
  pipeline_ok: boolean;
  meta_integration: { 
    found: boolean; 
    meta_asset_id?: string; 
    status?: string; 
    hint?: string 
  };
  created?: { 
    customer_id: string; 
    conversation_id: string; 
    message_id: string 
  };
  next_step?: string;
  error?: string;
  hint?: string;
}

export interface WebhookSubscriptionResult {
  channel_id: string;
  page_id: string;
  platform: string;
  meta_subscription_active: boolean;
  meta_subscribed_apps: Array<{ id: string; name: string }>;
  subscription_error: string | null;
}
