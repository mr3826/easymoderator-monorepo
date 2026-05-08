/**
 * Product and Category types
 */

export interface Product {
  id: string;
  name: string;
  sku: string;
  price: number;
  description?: string;
  category?: string;
  category_id?: string;
  status?: 'active' | 'inactive' | 'pending';
  variants?: unknown[];
  aliases?: string[];
  aiGenerated?: boolean;
  confidence?: number;
  stock?: boolean;
  images?: string[];
  brand?: string;
  weight?: number;
  weight_unit?: string;
  tags?: string[];
  compare_at_price?: number;
  cost_per_item?: number;
  quantity?: number;
  is_active?: boolean;
  low_stock_threshold?: number;
  track_quantity?: boolean;
  allow_discounts?: boolean;
  charge_tax?: boolean;
  send_low_stock_alert?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  shop_id?: string;
  name: string;
  description?: string;
  parent_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductExtractResult {
  products: Product[];
  stats: {
    total: number;
    parsed: number;
    skipped: number;
  };
}

export interface ProductUploadPayload {
  filename?: string;
  content_type?: string;
  content: string;
}
