import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, vi, beforeEach, afterEach } from 'vitest';
import { httpClient } from '@/shared/lib/http/client';

// Mock the CSRF error handler component
vi.mock('@/shared/components/CSRFErrorHandler', () => ({
  default: ({ error, onRetry, className }) => (
    <div data-testid="csrf-error-handler" className={className}>
      <div>Mock CSRF Error Handler</div>
      <button onClick={onRetry}>Retry</button>
    </div>
  ),
}));

describe('CSRF Integration', () => {
  beforeEach(() => {
    // Clear any existing tokens and reset HTTP client
    httpClient.clearCsrfToken();
    httpClient.setAccessToken(null);
    
    // Mock window events
    window.dispatchEvent = vi.fn();
    
    // Clear all event listeners
    window.removeEventListener = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('CSRF Token Initialization', () => {
    it('should initialize CSRF token on app load', async () => {
      const mockResponse = {
        data: { csrfToken: 'test-csrf-token-123' },
        status: 200,
      };
      
      vi.mocked(httpClient.get).mockResolvedValue(mockResponse);

      await httpClient.initCsrfToken();

      expect(httpClient.get).toHaveBeenCalledWith('/api/csrf');
      expect(vi.mocked(httpClient.get)).toHaveBeenCalledTimes(1);
    });

    it('should handle CSRF token initialization failure', async () => {
      const mockError = new Error('Network error');
      vi.mocked(httpClient.get).mockRejectedValue(mockError);

      await httpClient.initCsrfToken();

      // Should clear token on failure
      expect(httpClient.getAxiosInstance().defaults.headers['X-CSRF-Token']).toBeUndefined();
    });
  });

  describe('CSRF Token Injection', () => {
    it('should inject CSRF token for POST requests', async () => {
      // Initialize CSRF token
      vi.mocked(httpClient.get).mockResolvedValue({
        data: { csrfToken: 'test-csrf-token-123' },
      });
      await httpClient.initCsrfToken();

      // Mock POST request
      const mockPostResponse = { data: { success: true } };
      vi.mocked(httpClient.post).mockResolvedValue(mockPostResponse);

      await httpClient.post('/api/test', { data: 'test' });

      expect(httpClient.post).toHaveBeenCalledWith(
        '/api/test',
        { data: 'test' },
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-CSRF-Token': 'test-csrf-token-123',
          }),
        })
      );
    });

    it('should not inject CSRF token for GET requests', async () => {
      // Initialize CSRF token
      vi.mocked(httpClient.get).mockResolvedValue({
        data: { csrfToken: 'test-csrf-token-123' },
      });
      await httpClient.initCsrfToken();

      // Mock GET request
      const mockGetResponse = { data: { success: true } };
      vi.mocked(httpClient.get).mockResolvedValue(mockGetResponse);

      await httpClient.get('/api/test');

      expect(httpClient.get).toHaveBeenCalledWith(
        '/api/test',
        expect.not.objectContaining({
          headers: expect.objectContaining({
            'X-CSRF-Token': expect.any(String),
          }),
        })
      );
    });
  });

  describe('CSRF Error Handling', () => {
    it('should clear CSRF token on 403 response', async () => {
      // Mock 403 response for CSRF error
      const mockError = {
        response: {
          status: 403,
          data: { error: { message: 'invalid csrf token' } },
        },
      };
      vi.mocked(httpClient.post).mockRejectedValue(mockError);

      try {
        await httpClient.post('/api/test', { data: 'test' });
      } catch (error) {
        // Should have cleared the CSRF token
        expect(httpClient.getAxiosInstance().defaults.headers['X-CSRF-Token']).toBeUndefined();
      }
    });

    it('should emit custom event for CSRF errors', async () => {
      // Mock 403 response for CSRF error
      const mockError = {
        response: {
          status: 403,
          data: { error: { message: 'invalid csrf token' } },
        },
      };
      vi.mocked(httpClient.post).mockRejectedValue(mockError);

      // Add event listener
      const handleCsrfInvalid = vi.fn();
      window.addEventListener('csrf:invalid', handleCsrfInvalid);

      try {
        await httpClient.post('/api/test', { data: 'test' });
      } catch (error) {
        // Should emit custom event
        expect(handleCsrfInvalid).toHaveBeenCalled();
      }

      window.removeEventListener('csrf:invalid', handleCsrfInvalid);
    });
  });

  describe('CSRF Error Handler Component', () => {
    it('should display CSRF error message', () => {
      const mockError = new Error('invalid csrf token');
      const mockRetry = vi.fn();

      render(
        <CSRFErrorHandler 
          error={mockError} 
          onRetry={mockRetry}
          className="test-class"
        />
      );

      expect(screen.getByTestId('csrf-error-handler')).toBeInTheDocument();
      expect(screen.getByText('Session Expired')).toBeInTheDocument();
      expect(screen.getByText('Your session has expired. Please refresh the page and try again.')).toBeInTheDocument();
      expect(screen.getByText('Refresh Page')).toBeInTheDocument();
    });

    it('should call onRetry when retry button is clicked', async () => {
      const mockError = new Error('invalid csrf token');
      const mockRetry = vi.fn();

      render(
        <CSRFErrorHandler 
          error={mockError} 
          onRetry={mockRetry}
        />
      );

      const retryButton = screen.getByText('Refresh Page');
      await userEvent.click(retryButton);

      expect(mockRetry).toHaveBeenCalled();
    });
  });

  describe('End-to-End CSRF Flow', () => {
    it('should complete full CSRF flow successfully', async () => {
      // Mock successful CSRF token initialization
      vi.mocked(httpClient.get).mockResolvedValue({
        data: { csrfToken: 'test-csrf-token-123' },
      });

      // Mock successful POST request with CSRF token
      vi.mocked(httpClient.post).mockResolvedValue({
        data: { success: true },
      });

      // 1. Initialize CSRF token
      await httpClient.initCsrfToken();
      expect(httpClient.getAxiosInstance().defaults.headers['X-CSRF-Token']).toBe('test-csrf-token-123');

      // 2. Make POST request with CSRF token
      const response = await httpClient.post('/api/test', { data: 'test payload' });
      
      expect(response.data).toEqual({ success: true });
      expect(httpClient.post).toHaveBeenCalledWith(
        '/api/test',
        { data: 'test payload' },
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-CSRF-Token': 'test-csrf-token-123',
          }),
        })
      );
    });
  });
});
