/**
 * Audit Domain API Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as audit from '../audit';
import { httpClient } from '@/shared/lib/http/client';

vi.mock('@/shared/lib/http/client', () => ({
  httpClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe('Audit Domain API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAuditLogs', () => {
    it('should return audit logs without filters', async () => {
      const mockLogs = [
        { id: '1', action: 'HUMAN_TAKEOVER', resource_type: 'CONVERSATION', created_at: '2026-01-01' },
        { id: '2', action: 'ORDER_CONFIRMED', resource_type: 'ORDER', created_at: '2026-01-02' },
      ];
      (httpClient.get as any).mockResolvedValue({ data: { data: mockLogs } });

      const result = await audit.getAuditLogs();

      expect(httpClient.get).toHaveBeenCalledWith('/api/audit/logs');
      expect(result).toEqual(mockLogs);
      expect(result).toHaveLength(2);
    });

    it('should append query string when filters are provided', async () => {
      (httpClient.get as any).mockResolvedValue({ data: { data: [] } });

      await audit.getAuditLogs({ limit: 50, action: 'HUMAN_TAKEOVER' });

      const call = (httpClient.get as any).mock.calls[0][0] as string;
      expect(call).toContain('/api/audit/logs?');
      expect(call).toContain('limit=50');
      expect(call).toContain('action=HUMAN_TAKEOVER');
    });

    it('should filter by resourceType', async () => {
      (httpClient.get as any).mockResolvedValue({ data: { data: [] } });

      await audit.getAuditLogs({ resourceType: 'ORDER' });

      const call = (httpClient.get as any).mock.calls[0][0] as string;
      expect(call).toContain('resourceType=ORDER');
    });

    it('should omit undefined filter values from query string', async () => {
      (httpClient.get as any).mockResolvedValue({ data: { data: [] } });

      await audit.getAuditLogs({ limit: 100, action: undefined });

      const call = (httpClient.get as any).mock.calls[0][0] as string;
      expect(call).toContain('limit=100');
      expect(call).not.toContain('action=');
    });

    it('should return empty array when no logs', async () => {
      (httpClient.get as any).mockResolvedValue({ data: { data: [] } });

      const result = await audit.getAuditLogs();

      expect(result).toEqual([]);
    });

    it('should throw when request fails', async () => {
      (httpClient.get as any).mockRejectedValue(new Error('Network error'));

      await expect(audit.getAuditLogs()).rejects.toThrow('Network error');
    });
  });

  describe('getResourceAuditLogs', () => {
    it('should fetch logs for a specific resource', async () => {
      const mockLogs = [
        { id: '1', action: 'ORDER_CONFIRMED', resource_type: 'ORDER', resource_id: 'ord_1' },
      ];
      (httpClient.get as any).mockResolvedValue({ data: { data: mockLogs } });

      const result = await audit.getResourceAuditLogs('ORDER', 'ord_1');

      expect(httpClient.get).toHaveBeenCalledWith('/api/audit/resource/ORDER/ord_1');
      expect(result).toEqual(mockLogs);
    });

    it('should append pagination params when provided', async () => {
      (httpClient.get as any).mockResolvedValue({ data: { data: [] } });

      await audit.getResourceAuditLogs('CONVERSATION', 'conv_42', { limit: 20, offset: 40 });

      const call = (httpClient.get as any).mock.calls[0][0] as string;
      expect(call).toContain('/api/audit/resource/CONVERSATION/conv_42?');
      expect(call).toContain('limit=20');
      expect(call).toContain('offset=40');
    });

    it('should work without options', async () => {
      (httpClient.get as any).mockResolvedValue({ data: { data: [] } });

      await audit.getResourceAuditLogs('CHANNEL', 'ch_5');

      expect(httpClient.get).toHaveBeenCalledWith('/api/audit/resource/CHANNEL/ch_5');
    });

    it('should throw on request failure', async () => {
      (httpClient.get as any).mockRejectedValue(new Error('Unauthorized'));

      await expect(audit.getResourceAuditLogs('ORDER', 'ord_x')).rejects.toThrow('Unauthorized');
    });
  });
});
