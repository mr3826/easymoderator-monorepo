/**
 * MW-V1 CRM Lite types — staff-private notes + shop-scoped merchant tags.
 * Mirrors EasyMod-backend customer-notes/customer-tags contracts (docs 05).
 */

export interface CustomerNote {
  id: string;
  shop_id: string;
  customer_id: string;
  body: string;
  author_id: string | null;
  author_name: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CustomerTag {
  id: string;
  shop_id: string;
  name: string;
  created_by?: string | null;
  usage_count?: number;
}
