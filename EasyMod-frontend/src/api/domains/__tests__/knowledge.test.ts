/**
 * Knowledge Domain API Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as knowledge from '../knowledge';
import { httpClient } from '@/shared/lib/http/client';

vi.mock('@/shared/lib/http/client', () => ({
  httpClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('Knowledge Domain API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getKnowledgeSummary', () => {
    it('should return knowledge summary', async () => {
      const mockResponse = {
        data: {
          data: {
            faqs: [{ id: '1', question: 'Q1', answer: 'A1' }],
            documents: [{ id: '1', title: 'Doc1' }],
            businessInfo: { shopName: 'My Shop' },
          },
        },
      };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      const result = await knowledge.getKnowledgeSummary();

      expect(httpClient.get).toHaveBeenCalledWith('/knowledge');
      expect(result.faqs).toHaveLength(1);
    });
  });

  describe('updateBusinessInfo', () => {
    it('should update business info', async () => {
      const businessInfo = { shopName: 'My Shop', address: '123 Main St' };
      const mockResponse = { data: { data: { ...businessInfo, faqs: [] } } };
      (httpClient.put as any).mockResolvedValue(mockResponse);

      await knowledge.updateBusinessInfo(businessInfo as any);

      expect(httpClient.put).toHaveBeenCalledWith('/knowledge/business-info', businessInfo);
    });
  });

  describe('updateBrandingRules', () => {
    it('should update branding rules', async () => {
      const brandingRules = { tone: 'friendly' };
      const mockResponse = { data: { data: { ...brandingRules, faqs: [] } } };
      (httpClient.put as any).mockResolvedValue(mockResponse);

      await knowledge.updateBrandingRules(brandingRules as any);

      expect(httpClient.put).toHaveBeenCalledWith('/knowledge/branding', brandingRules);
    });
  });

  describe('listFaqs', () => {
    it('should return FAQ list', async () => {
      const mockResponse = {
        data: {
          data: [
            { id: '1', question: 'Q1', answer: 'A1', keywords: [] },
            { id: '2', question: 'Q2', answer: 'A2', keywords: [] },
          ],
        },
      };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      const result = await knowledge.listFaqs();

      expect(httpClient.get).toHaveBeenCalledWith('/knowledge/faqs');
      expect(result).toHaveLength(2);
    });
  });

  describe('createFaq', () => {
    it('should create FAQ', async () => {
      const faqData = { question: 'New Q?', answer: 'New A', keywords: [] };
      const mockResponse = { data: { data: { id: '3', ...faqData } } };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      const result = await knowledge.createFaq(faqData as any);

      expect(httpClient.post).toHaveBeenCalledWith('/knowledge/faqs', faqData);
      expect(result.id).toBe('3');
    });
  });

  describe('updateFaq', () => {
    it('should update FAQ', async () => {
      const updateData = { answer: 'Updated answer' };
      const mockResponse = { data: { data: { id: '1', ...updateData } } };
      (httpClient.patch as any).mockResolvedValue(mockResponse);

      await knowledge.updateFaq('1', updateData);

      expect(httpClient.patch).toHaveBeenCalledWith('/knowledge/faqs/1', updateData);
    });
  });

  describe('deleteFaq', () => {
    it('should delete FAQ', async () => {
      (httpClient.delete as any).mockResolvedValue({ data: {} });

      await knowledge.deleteFaq('1');

      expect(httpClient.delete).toHaveBeenCalledWith('/knowledge/faqs/1');
    });
  });

  describe('listKnowledgeGaps', () => {
    it('should return knowledge gaps', async () => {
      const mockResponse = {
        data: {
          data: [
            { id: '1', question: 'Unknown?', frequency: 10, status: 'pending' },
          ],
        },
      };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      const result = await knowledge.listKnowledgeGaps();

      expect(httpClient.get).toHaveBeenCalledWith('/knowledge/gaps');
      expect(result[0].frequency).toBe(10);
    });
  });

  describe('listDocuments', () => {
    it('should return documents list', async () => {
      const mockResponse = {
        data: {
          data: [
            { id: '1', title: 'Price List', fileName: 'prices.pdf', fileType: 'pdf' },
          ],
        },
      };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      const result = await knowledge.listDocuments();

      expect(httpClient.get).toHaveBeenCalledWith('/knowledge/documents');
      expect(result[0].fileType).toBe('pdf');
    });
  });
});
