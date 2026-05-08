/**
 * Customer types
 */

export type ChannelType = 'facebook' | 'manual' | 'messenger' | 'instagram';

export interface Customer {
  id: string;
  shop_id: string;
  name: string | null;
  email?: string;
  number: string;
  channel: ChannelType;
  created_at: string;
  updated_at: string;
  rto_risk?: 'high' | 'medium' | 'low';
  blacklisted?: boolean;
  rto_count?: number;
}

export interface CustomerFilters {
  search?: string;
  email?: string;
  number?: string;
  channel_type?: ChannelType;
  start_date?: string;
  end_date?: string;
  page?: number;
  pageSize?: number;
}

export interface CustomerListResponse {
  data: Customer[];
  total: number;
  page: number;
  pageSize: number;
}
