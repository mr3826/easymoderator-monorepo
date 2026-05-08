/**
 * Centralized API Error Handling & Normalization
 * 
 * All backend errors are normalized to this structure,
 * making error handling consistent across the app
 */

import { AxiosError } from 'axios';

export type ApiErrorType = 
  | 'NETWORK_ERROR'
  | 'TIMEOUT_ERROR'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'SERVER_ERROR'
  | 'UNKNOWN_ERROR';

export interface NormalizedApiError {
  type: ApiErrorType;
  statusCode: number;
  message: string;
  details?: Record<string, any>;
  code?: string;
  timestamp: string;
}

/**
 * Normalize any error to a consistent structure
 * Backend error format expected:
 * {
 *   success: false,
 *   error: {
 *     code: 'VALIDATION_ERROR',
 *     message: 'Invalid input',
 *     details: { field: [...messages] }
 *   }
 * }
 */
export function normalizeApiError(error: any): NormalizedApiError {
  const timestamp = new Date().toISOString();

  // Network/timeout errors
  if (!error.response) {
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      return {
        type: 'TIMEOUT_ERROR',
        statusCode: 408,
        message: 'Request timeout. Please try again.',
        timestamp,
      };
    }

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return {
        type: 'NETWORK_ERROR',
        statusCode: 0,
        message: 'Network error. Please check your connection.',
        timestamp,
      };
    }

    return {
      type: 'UNKNOWN_ERROR',
      statusCode: 0,
      message: error.message || 'An unexpected error occurred',
      timestamp,
    };
  }

  const status = error.response.status;
  const data = error.response.data;

  // Map HTTP status codes to error types
  let errorType: ApiErrorType = 'UNKNOWN_ERROR';
  if (status === 400) errorType = 'VALIDATION_ERROR';
  else if (status === 401) errorType = 'UNAUTHORIZED';
  else if (status === 403) errorType = 'FORBIDDEN';
  else if (status === 404) errorType = 'NOT_FOUND';
  else if (status === 409) errorType = 'CONFLICT';
  else if (status >= 500) errorType = 'SERVER_ERROR';

  // Extract backend error message
  const message =
    data?.error?.message ||
    data?.message ||
    getDefaultErrorMessage(status);

  const details =
    data?.error?.details ||
    data?.details;

  return {
    type: errorType,
    statusCode: status,
    message,
    details,
    code: data?.error?.code,
    timestamp,
  };
}

function getDefaultErrorMessage(status: number): string {
  const messages: Record<number, string> = {
    400: 'Invalid request. Please check your input.',
    401: 'Unauthorized. Please login again.',
    403: 'You do not have permission to perform this action.',
    404: 'Resource not found.',
    409: 'Conflict. This resource already exists.',
    500: 'Server error. Please try again later.',
    503: 'Service unavailable. Please try again later.',
  };

  return messages[status] || 'An error occurred. Please try again.';
}

/**
 * Check if error is a specific type
 * Usage: isApiError(error, 'VALIDATION_ERROR')
 */
export function isApiError(
  error: any,
  type?: ApiErrorType
): error is NormalizedApiError {
  if (!error || typeof error !== 'object') return false;
  if (!('type' in error) || !('statusCode' in error)) return false;
  if (type && error.type !== type) return false;
  return true;
}

/**
 * Get user-friendly error message for display
 */
export function getErrorMessage(error: any): string {
  if (isApiError(error)) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unexpected error occurred';
}

/**
 * Get field-level validation errors
 * Usage: const errors = getValidationErrors(error);
 *        errors?.email?.join(', ')
 */
export function getValidationErrors(
  error: any
): Record<string, string[]> | undefined {
  if (isApiError(error, 'VALIDATION_ERROR') && error.details) {
    return error.details;
  }
  return undefined;
}
