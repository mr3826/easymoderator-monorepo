import React, { useEffect, useState } from 'react';
import { AlertCircle, X, RefreshCw } from 'lucide-react';
import { httpClient } from '@/shared/lib/http/client';

interface CSRFErrorHandlerProps {
  error?: Error;
  onRetry?: () => void;
  className?: string;
}

export default function CSRFErrorHandler({ error, onRetry, className = '' }: CSRFErrorHandlerProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (error) {
      setIsVisible(true);
      
      // Auto-hide after 8 seconds
      const timer = setTimeout(() => {
        setIsVisible(false);
      }, 8000);
      
      return () => clearTimeout(timer);
    }
  }, [error]);

  if (!error || !isVisible) return null;

  const isCsrfError = error?.message?.toLowerCase().includes('csrf');
  const isAuthError = error?.message?.toLowerCase().includes('unauthorized') || error?.message?.toLowerCase().includes('invalid token');

  const getErrorMessage = () => {
    if (isCsrfError) {
      return 'Your session has expired. Please refresh the page and try again.';
    }
    if (isAuthError) {
      return 'Your authentication has expired. Please sign in again.';
    }
    return 'Something went wrong. Please try again.';
  };

  const handleRetry = () => {
    setIsVisible(false);
    if (isCsrfError) {
      // Re-initialize CSRF token for CSRF errors
      httpClient.initCsrfToken();
    }
    onRetry?.();
  };

  const handleRefresh = async () => {
    setIsVisible(false);
    try {
      // Clear current CSRF token and get a new one
      await httpClient.initCsrfToken();
      window.location.reload();
    } catch (refreshError) {
      console.error('Failed to refresh CSRF token:', refreshError);
    }
  };

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        {/* Icon */}
        <div className="flex items-center justify-center w-12 h-12 bg-red-100 rounded-full mb-4">
          <AlertCircle className="w-6 h-6 text-red-600" />
        </div>

        {/* Content */}
        <div className="text-center">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {isCsrfError ? 'Session Expired' : 'Authentication Error'}
          </h3>
          
          <p className="text-gray-600 mb-6">
            {getErrorMessage()}
          </p>

          {/* Action Buttons */}
          <div className="flex flex-col gap-3">
            {isCsrfError && (
              <button
                onClick={handleRetry}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh Page
              </button>
            )}

            {isAuthError && (
              <button
                onClick={() => window.location.href = '/signin'}
                className="w-full flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Sign In Again
              </button>
            )}

            <button
              onClick={() => setIsVisible(false)}
              className="w-full flex items-center justify-center gap-2 bg-gray-200 text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-300 transition-colors"
            >
              <X className="w-4 h-4" />
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
