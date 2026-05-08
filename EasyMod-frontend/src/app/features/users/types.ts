/**
 * Users Feature Types
 * Defines all TypeScript interfaces for the Users management feature
 */

export type UserRole = 'admin' | 'moderator' | 'user' | 'owner' | 'manager' | 'staff';

export interface User {
  id: string;
  shopId: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  name: string;
  email: string;
  role: UserRole;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  role?: UserRole;
  isActive?: boolean;
}

export interface UsersListResponse {
  data: User[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserFormState {
  userId?: string;
  name: string;
  email: string;
  role: UserRole;
  errors: Record<string, string>;
  isLoading?: boolean;
}

export interface UsersTableState {
  users: User[];
  totalCount: number;
  isLoading: boolean;
  error?: string;
  selectedUserId?: string;
  sortBy?: keyof User;
  sortOrder?: 'asc' | 'desc';
}

export const SHOP_ROLES: UserRole[] = ['owner', 'manager', 'staff'];
export const SYSTEM_ROLES: UserRole[] = ['admin', 'moderator', 'user'];

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'System Admin',
  moderator: 'Moderator',
  user: 'User',
  owner: 'Shop Owner',
  manager: 'Shop Manager',
  staff: 'Shop Staff',
};
