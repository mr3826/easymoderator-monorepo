/**
 * Campaign Domain API Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as campaign from '../campaign';
import { httpClient } from '@/shared/lib/http/client';

vi.mock('@/shared/lib/http/client', () => ({
  httpClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('Campaign Domain API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCampaigns', () => {
    it('should return campaigns list', async () => {
      const mockResponse = {
        data: {
          data: [
            { id: '1', name: 'Summer Sale', status: 'active' },
            { id: '2', name: 'New Arrivals', status: 'draft' },
          ],
        },
      };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      const result = await campaign.getCampaigns();

      expect(httpClient.get).toHaveBeenCalledWith('/campaign');
      expect(result).toHaveLength(2);
    });
  });

  describe('getCampaign', () => {
    it('should return single campaign', async () => {
      const mockResponse = {
        data: {
          data: { id: '1', name: 'Summer Sale', status: 'active' },
        },
      };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      const result = await campaign.getCampaign('1');

      expect(httpClient.get).toHaveBeenCalledWith('/campaign/1');
      expect(result.name).toBe('Summer Sale');
    });
  });

  describe('createCampaign', () => {
    it('should create campaign', async () => {
      const campaignData = { name: 'Holiday Special', message: 'Check out deals!' };
      const mockResponse = {
        data: { data: { id: '3', ...campaignData, status: 'draft' } },
      };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      const result = await campaign.createCampaign(campaignData as any);

      expect(httpClient.post).toHaveBeenCalledWith('/campaign', campaignData);
      expect(result.status).toBe('draft');
    });
  });

  describe('updateCampaign', () => {
    it('should update campaign', async () => {
      const updateData = { name: 'Updated Name' };
      const mockResponse = {
        data: { data: { id: '1', ...updateData } },
      };
      (httpClient.patch as any).mockResolvedValue(mockResponse);

      await campaign.updateCampaign('1', updateData);

      expect(httpClient.patch).toHaveBeenCalledWith('/campaign/1', updateData);
    });
  });

  describe('deleteCampaign', () => {
    it('should delete campaign', async () => {
      (httpClient.delete as any).mockResolvedValue({ data: {} });

      await campaign.deleteCampaign('1');

      expect(httpClient.delete).toHaveBeenCalledWith('/campaign/1');
    });
  });

  describe('scheduleCampaign', () => {
    it('should schedule campaign', async () => {
      const scheduledTime = '2024-12-25T10:00:00Z';
      const mockResponse = {
        data: { data: { id: '1', status: 'scheduled', scheduledAt: scheduledTime } },
      };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      const result = await campaign.scheduleCampaign('1', scheduledTime);

      expect(httpClient.post).toHaveBeenCalledWith('/campaign/1/schedule', { scheduledAt: scheduledTime });
      expect(result.status).toBe('scheduled');
    });
  });

  describe('launchCampaign', () => {
    it('should launch campaign immediately', async () => {
      const mockResponse = {
        data: { data: { id: '1', status: 'sending' } },
      };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      const result = await campaign.launchCampaign('1');

      expect(httpClient.post).toHaveBeenCalledWith('/campaign/1/launch');
      expect(result.status).toBe('sending');
    });
  });

  describe('getCampaignStats', () => {
    it('should return campaign statistics', async () => {
      const mockResponse = {
        data: {
          data: {
            sent: 1500,
            delivered: 1400,
            opened: 800,
            clicked: 300,
          },
        },
      };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      const result = await campaign.getCampaignStats('1');

      expect(httpClient.get).toHaveBeenCalledWith('/campaign/1/stats');
      expect(result.delivered).toBe(1400);
    });
  });
});
