/**
 * HTTP Client exports
 */

export { httpClient } from './client';
export { useAuthHttpShopId } from './useAuthHttpShopId';
export { 
  normalizeApiError, 
  isApiError, 
  getErrorMessage, 
  getValidationErrors,
  type NormalizedApiError,
  type ApiErrorType,
} from './errors';
