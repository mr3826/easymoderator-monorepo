/**
 * Channel Domain API Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as channel from '../channel';
import { httpClient } from '@/shared/lib/http/client';

vi.mock('@/shared/lib/http/client', () => ({
  httpClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('Channel Domain API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getChannels', () => {
    it('should return channels list', async () => {
      const mockResponse = {
        data: {
          data: [
            { id: '1', channel_type: 'messenger', is_active: true },
            { id: '2', channel_type: 'instagram', is_active: false },
          ],
        },
      };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      const result = await channel.getChannels();

      expect(httpClient.get).toHaveBeenCalledWith('/channel');
      expect(result).toHaveLength(2);
    });
  });

  describe('getChannel', () => {
    it('should return single channel', async () => {
      const mockResponse = {
        data: {
          data: { id: '1', channel_type: 'messenger', settings: {} },
        },
      };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      const result = await channel.getChannel('1');

      expect(httpClient.get).toHaveBeenCalledWith('/channel/1');
    });
  });

  describe('createChannel', () => {
    it('should create channel', async () => {
      const channelData = { channel_type: 'telegram', name: 'Telegram Channel' };
      const mockResponse = {
        data: { data: { id: '3', ...channelData, is_active: false } },
      };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      const result = await channel.createChannel(channelData as any);

      expect(httpClient.post).toHaveBeenCalledWith('/channel', channelData);
    });
  });

  describe('updateChannel', () => {
    it('should update channel settings', async () => {
      const updateData = { name: 'Updated Channel', settings: { auto_reply: true } };
      const mockResponse = {
        data: { data: { id: '1', ...updateData } },
      };
      (httpClient.patch as any).mockResolvedValue(mockResponse);

      const result = await channel.updateChannel('1', updateData);

      expect(httpClient.patch).toHaveBeenCalledWith('/channel/1', updateData);
    });
  });

  describe('deleteChannel', () => {
    it('should delete channel', async () => {
      const mockResponse = {
        data: { data: { message: 'Channel deleted' } },
      };
      (httpClient.delete as any).mockResolvedValue(mockResponse);

      const result = await channel.deleteChannel('1');

      expect(httpClient.delete).toHaveBeenCalledWith('/channel/1');
      expect(result.message).toBe('Channel deleted');
    });
  });

  describe('initiateOAuth', () => {
    it('should initiate OAuth flow', async () => {
      const mockResponse = {
        data: {
          data: {
            redirectUrl: 'https://facebook.com/v12.0/dialog/oauth?client_id=123',
            state: 'state123',
          },
        },
      };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      const result = await channel.initiateOAuth('facebook');

      expect(httpClient.post).toHaveBeenCalledWith('/channel/oauth/initiate', { channelType: 'facebook' });
      expect(result.redirectUrl).toContain('facebook.com');
    });
  });

  describe('handleOAuthCallback', () => {
    it('should handle OAuth callback', async () => {
      const mockResponse = {
        data: {
          data: {
            pages: [{ id: 'page1', name: 'Page 1', access_token: 'token123' }],
          },
        },
      };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      const result = await channel.handleOAuthCallback('auth-code', 'state123', 'facebook');

      expect(httpClient.post).toHaveBeenCalledWith('/channel/oauth/callback', {
        code: 'auth-code',
        state: 'state123',
        channelType: 'facebook',
      });
      expect(result.pages).toHaveLength(1);
    });
  });

  describe('connectOAuthPage', () => {
    it('should connect selected page', async () => {
      const mockResponse = {
        data: {
          data: { id: 'channel123', channel_type: 'facebook', page_id: 'page1' },
        },
      };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      const result = await channel.connectOAuthPage('page1', 'My Page', 'tempToken123', 'facebook');

      expect(httpClient.post).toHaveBeenCalledWith('/channel/oauth/connect-page', {
        pageId: 'page1',
        pageName: 'My Page',
        tempToken: 'tempToken123',
        channelType: 'facebook',
      });
    });
  });

  describe('disconnectChannel', () => {
    it('should disconnect channel', async () => {
      const mockResponse = {
        data: { data: { id: '1', channel_type: 'facebook', is_active: false } },
      };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      const result = await channel.disconnectChannel('1');

      expect(httpClient.post).toHaveBeenCalledWith('/channel/1/disconnect');
    });
  });

  describe('testChannelPipeline', () => {
    it('should test channel connection', async () => {
      const mockResponse = {
        data: { data: { success: true, message: 'Connection successful', test_message_sent: true } },
      };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      const result = await channel.testChannelPipeline('1');

      expect(httpClient.post).toHaveBeenCalledWith('/channel/1/test-pipeline');
      expect(result.success).toBe(true);
    });
  });

  describe('subscribeChannelWebhooks', () => {
    it('should subscribe webhooks', async () => {
      const mockResponse = {
        data: { data: { subscribed: true, webhook_url: 'https://api.example.com/webhook' } },
      };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      const result = await channel.subscribeChannelWebhooks('1');

      expect(httpClient.post).toHaveBeenCalledWith('/channel/1/subscribe-webhooks');
      expect(result.subscribed).toBe(true);
    });
  });
});
