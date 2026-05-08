/**
 * Campaign types
 */

export interface CampaignSegmentFilter {
  minOrders?: number;
  paymentMethod?: string;
  requireConsent?: boolean;
  recipientCap?: number;
}

export interface Campaign {
  id: string;
  shop_id: string;
  name: string;
  message_template: string;
  segment_filter: CampaignSegmentFilter;
  status: 'draft' | 'scheduled' | 'running' | 'completed' | 'failed';
  scheduled_at?: string | null;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
  updated_at: string;
}

export interface CampaignStats {
  id: string;
  name: string;
  status: Campaign['status'];
  scheduled_at?: string | null;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCampaignRequest {
  name: string;
  message_template: string;
  segment_filter?: CampaignSegmentFilter;
}
