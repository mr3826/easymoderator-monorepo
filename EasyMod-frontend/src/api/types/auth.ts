/**
 * Authentication and User types
 */

export interface User {
  id: string;
  email: string;
  full_name: string;
  phone?: string;
  profile_picture?: string;
}

export interface Shop {
  id: string;
  unique_code: string;
  shop_name?: string;
  role: 'owner' | 'admin' | 'staff';
  settings?: { 
    onboarding_completed?: boolean; 
    [key: string]: unknown 
  };
}

export interface AuthResponse {
  user: User;
  currentShop: Shop;
  allShops: Shop[];
  shop?: Shop;
}

export interface SigninRequest {
  email: string;
  password: string;
}

export interface SignupRequest {
  email: string;
  password: string;
  full_name: string;
  phone?: string;
}

export interface CreateShopRequest {
  shop_name?: string;
}

export interface PasswordResetRequest {
  email: string;
}

export interface PasswordUpdateRequest {
  token: string;
  password: string;
}
