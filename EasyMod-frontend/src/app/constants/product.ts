/**
 * Product Module Constants
 * Centralized constants to avoid magic numbers across the frontend codebase
 */

// HTTP Status Codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
} as const;

// UI Timeouts (in milliseconds)
export const TIMEOUTS = {
  API_REQUEST: 10000,
  DEBOUNCE: 300,
  TOAST_DURATION: 4000,
  MODAL_ANIMATION: 200,
} as const;

// Validation Limits
export const VALIDATION = {
  MAX_NAME_LENGTH: 255,
  MAX_SKU_LENGTH: 100,
  MAX_DESCRIPTION_LENGTH: 2000,
  MAX_TAG_LENGTH: 50,
  MAX_TAGS: 20,
  MAX_IMAGES: 5,
  MAX_VARIANTS: 10,
  MAX_VARIANT_OPTIONS: 20,
  MIN_PRICE: 0.01,
} as const;

// Stock Management
export const STOCK = {
  MIN_QUANTITY: 0,
  DEFAULT_THRESHOLD: 5,
  UNLIMITED: 'unlimited',
  LIMITED: 'limited',
} as const;

// Product Conditions
export const PRODUCT_CONDITIONS = ['new', 'used', 'refurbished'] as const;

// Weight Units
export const WEIGHT_UNITS = ['kg', 'g', 'lb', 'oz'] as const;

// Dimension Units
export const DIMENSION_UNITS = ['cm', 'in'] as const;

// Shipping Classes
export const SHIPPING_CLASSES = ['standard', 'express', 'fragile'] as const;

// Handling Time Options
export const HANDLING_TIME_OPTIONS = [
  { value: '1-3', label: '1-3 business days' },
  { value: '3-5', label: '3-5 business days' },
  { value: '5-7', label: '5-7 business days' },
  { value: '7-14', label: '1-2 weeks' },
] as const;

// Return Windows (in days)
export const RETURN_WINDOWS = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
] as const;

// Default Values
export const DEFAULTS = {
  MIN_ORDER_QTY: '1',
  RETURN_WINDOW: '7',
  WEIGHT_UNIT: 'kg' as const,
  DIMENSION_UNIT: 'cm' as const,
  SHIPPING_CLASS: 'standard' as const,
  HANDLING_TIME: '1-3',
  STOCK_TYPE: 'limited' as const,
} as const;

// SKU Prefix
export const SKU_PREFIX = 'PRD-';
export const SKU_LENGTH = 7;
