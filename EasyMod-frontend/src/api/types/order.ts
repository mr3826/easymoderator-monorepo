/**
 * Order and Delivery types
 */

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
}

export interface DeliveryAddress {
  division: string;
  district: string;
  upazila: string;
  street_address: string;
  zone?: 'inside_dhaka' | 'sub_dhaka' | 'outside_dhaka';
}

export interface Order {
  id: string;
  customerName: string;
  customerPhone?: string;
  deliveryAddress?: string;
  delivery_address?: DeliveryAddress;
  items: OrderItem[];
  total: number;
  status: 'draft' | 'confirmed' | 'processing' | 'completed' | 'cancelled';
  channel: string;
  createdAt: string;
  updatedAt: string;
  rto_risk?: 'high' | 'medium' | 'low';
  payment_status?: string;
  delivery_tracking_code?: string;
  delivery_provider?: string;
  delivery_booked_at?: string;
  note?: string;
}

export type DeliveryProvider = 'pathao' | 'steadfast' | 'redx';

export interface DeliveryProviderStatus {
  provider: DeliveryProvider;
  display_name: string;
  is_connected: boolean;
  is_active: boolean;
  metadata?: Record<string, unknown>;
  last_validated_at: string | null;
  connected_at: string | null;
}

export interface DeliveryAreaPricing {
  zone: 'inside_dhaka' | 'sub_dhaka' | 'outside_dhaka';
  charge: number;
  cod_enabled: boolean;
}

export interface DeliveryWeightTier {
  from_kg: number;
  to_kg: number;
  extra_charge: number;
}

export interface DeliveryShopSettings {
  default_delivery_charge: number;
  cod_enabled: boolean;
  cod_charge: number;
  non_refundable: boolean;
  area_pricing: DeliveryAreaPricing[];
  weight_tiers: DeliveryWeightTier[];
}

export interface DeliverySettings {
  providers: DeliveryProviderStatus[];
  settings: DeliveryShopSettings;
}

export interface CourierBookingPayload {
  provider: DeliveryProvider;
  recipient_name: string;
  recipient_phone: string;
  recipient_address: string;
  cod_amount: number;
  weight_kg?: number;
  item_description?: string;
}

export interface CourierBookingResult {
  tracking_id: string;
  consignment_id?: string;
  provider: string;
  booked_at: string;
}

export interface PathaoCredentials {
  client_id: string;
  client_secret: string;
  username: string;
  password: string;
}

export interface SteadfastCredentials {
  api_key: string;
  secret_key: string;
}

export interface RedxCredentials {
  api_key: string;
}

export type DeliveryCredentials = PathaoCredentials | SteadfastCredentials | RedxCredentials;

export interface ConnectDeliveryProviderRequest {
  provider: DeliveryProvider;
  credentials: DeliveryCredentials;
  is_sandbox?: boolean;
  metadata?: Record<string, unknown>;
}
