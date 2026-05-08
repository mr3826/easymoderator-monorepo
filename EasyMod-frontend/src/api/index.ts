/**
 * New API Layer - Centralized HTTP Client and Domain APIs
 * 
 * This module provides a clean, domain-based API structure
 * that consolidates all HTTP communication through a single client.
 * 
 * Migration from old api.ts:
 * - Import types from '@/api/types'
 * - Import API functions from '@/api/domains/[domain]'
 * - The httpClient is available at '@/shared/lib/http/client'
 * 
 * Example usage:
 * ```typescript
 * import { auth, product } from '@/api/domains';
 * import type { User, Product } from '@/api/types';
 * 
 * const user = await auth.getAuthContext();
 * const products = await product.getProducts();
 * ```
 */

// Re-export types
export * from './types';

// Re-export domain APIs as namespaces
export * from './domains';

// Re-export httpClient for advanced use cases
export { httpClient } from '@/shared/lib/http/client';
export type { ExtendedAxiosRequestConfig } from '@/shared/lib/http/client';

// Re-export error utilities
export {
  normalizeApiError,
  isApiError,
  getErrorMessage,
  getValidationErrors,
  type ApiErrorType,
  type NormalizedApiError,
} from '@/shared/lib/http/errors';

/**
 * Backward compatibility exports
 * These maintain compatibility with the old api.ts exports
 * while migrating to the new structure
 */

// Import domains for re-export
import * as authDomain from './domains/auth';
import * as productDomain from './domains/product';
import * as orderDomain from './domains/order';
import * as customerDomain from './domains/customer';
import * as channelDomain from './domains/channel';
import * as dashboardDomain from './domains/dashboard';
import * as knowledgeDomain from './domains/knowledge';
import * as campaignDomain from './domains/campaign';
import * as subscriptionDomain from './domains/subscription';
import * as conversationDomain from './domains/conversation';

// Legacy ApiClient singleton for gradual migration
import { httpClient } from '@/shared/lib/http/client';

/**
 * @deprecated Use auth domain directly: import { auth } from '@/api/domains'
 */
export const apiClient = {
  // Auth methods
  signin: authDomain.signin,
  signup: authDomain.signup,
  forgotPassword: authDomain.forgotPassword,
  resetPassword: authDomain.resetPassword,
  logout: authDomain.logout,
  getAuthContext: authDomain.getAuthContext,
  refreshToken: authDomain.refreshToken,
  getShops: authDomain.getShops,
  createShop: authDomain.createShop,
  switchShop: authDomain.switchShop,
  getShopAgents: authDomain.getShopAgents,

  // Product methods
  getProducts: productDomain.getProducts,
  getProduct: productDomain.getProduct,
  createProduct: productDomain.createProduct,
  updateProduct: productDomain.updateProduct,
  deleteProduct: productDomain.deleteProduct,
  extractProductsFromUpload: productDomain.extractProductsFromUpload,
  getCategories: productDomain.getCategories,
  getCategory: productDomain.getCategory,
  createCategory: productDomain.createCategory,
  updateCategory: productDomain.updateCategory,
  deleteCategory: productDomain.deleteCategory,

  // Order methods
  getOrders: orderDomain.getOrders,
  getOrder: orderDomain.getOrder,
  createOrder: orderDomain.createOrder,
  updateOrder: orderDomain.updateOrder,
  confirmOrder: orderDomain.confirmOrder,
  cancelOrder: orderDomain.cancelOrder,
  bookCourier: orderDomain.bookCourier,
  getDeliverySettings: orderDomain.getDeliverySettings,
  connectDeliveryProvider: orderDomain.connectDeliveryProvider,
  disconnectDeliveryProvider: orderDomain.disconnectDeliveryProvider,
  toggleDeliveryProvider: orderDomain.toggleDeliveryProvider,
  updateDeliverySettings: orderDomain.updateDeliverySettings,

  // Customer methods
  getCustomers: customerDomain.getCustomers,
  getCustomer: customerDomain.getCustomer,
  createCustomer: customerDomain.createCustomer,
  updateCustomer: customerDomain.updateCustomer,
  blacklistCustomer: customerDomain.blacklistCustomer,
  removeFromBlacklist: customerDomain.removeFromBlacklist,

  // Channel methods
  getChannels: channelDomain.getChannels,
  getChannel: channelDomain.getChannel,
  createChannel: channelDomain.createChannel,
  updateChannel: channelDomain.updateChannel,
  deleteChannel: channelDomain.deleteChannel,
  initiateOAuth: channelDomain.initiateOAuth,
  handleOAuthCallback: channelDomain.handleOAuthCallback,
  connectOAuthPage: channelDomain.connectOAuthPage,
  disconnectChannel: channelDomain.disconnectChannel,
  testChannelPipeline: channelDomain.testChannelPipeline,
  subscribeChannelWebhooks: channelDomain.subscribeChannelWebhooks,

  // Dashboard methods
  getDashboardMetrics: dashboardDomain.getDashboardMetrics,
  getDashboardQueue: dashboardDomain.getDashboardQueue,
  getKnowledgeGaps: dashboardDomain.getKnowledgeGaps,
  getAnalytics: dashboardDomain.getAnalytics,

  // Knowledge methods
  getKnowledgeSummary: knowledgeDomain.getKnowledgeSummary,
  updateBusinessInfo: knowledgeDomain.updateBusinessInfo,
  updateBrandingRules: knowledgeDomain.updateBrandingRules,
  listKnowledgeFaqs: knowledgeDomain.listFaqs,
  createKnowledgeFaq: knowledgeDomain.createFaq,
  updateKnowledgeFaq: knowledgeDomain.updateFaq,
  deleteKnowledgeFaq: knowledgeDomain.deleteFaq,
  listKnowledgeGaps: knowledgeDomain.listKnowledgeGaps,
  listKnowledgeDocuments: knowledgeDomain.listDocuments,
  createKnowledgeDocument: knowledgeDomain.createDocument,

  // Campaign methods
  getCampaigns: campaignDomain.getCampaigns,
  getCampaign: campaignDomain.getCampaign,
  createCampaign: campaignDomain.createCampaign,
  updateCampaign: campaignDomain.updateCampaign,
  deleteCampaign: campaignDomain.deleteCampaign,
  scheduleCampaign: campaignDomain.scheduleCampaign,
  launchCampaign: campaignDomain.launchCampaign,
  getCampaignStats: campaignDomain.getCampaignStats,

  // Subscription methods
  getSubscription: subscriptionDomain.getSubscription,
  getSubscriptionPlans: subscriptionDomain.getSubscriptionPlans,
  subscribeToPlan: subscriptionDomain.subscribeToPlan,
  cancelSubscription: subscriptionDomain.cancelSubscription,
  reactivateSubscription: subscriptionDomain.reactivateSubscription,
  getPaymentMethods: subscriptionDomain.getPaymentMethods,
  addPaymentMethod: subscriptionDomain.addPaymentMethod,
  removePaymentMethod: subscriptionDomain.removePaymentMethod,
  setDefaultPaymentMethod: subscriptionDomain.setDefaultPaymentMethod,
  getInvoices: subscriptionDomain.getInvoices,
  getInvoice: subscriptionDomain.getInvoice,

  // Conversation methods
  getConversations: conversationDomain.getConversations,
  getConversation: conversationDomain.getConversation,
  getMessages: conversationDomain.getMessages,
  createMessage: conversationDomain.createMessage,
  updateConversation: conversationDomain.updateConversation,
  transcribeVoice: conversationDomain.transcribeVoice,
  getResponseTemplates: conversationDomain.getResponseTemplates,
  createTemplate: conversationDomain.createTemplate,
  updateTemplate: conversationDomain.updateTemplate,
  deleteTemplate: conversationDomain.deleteTemplate,
  createAuditLog: conversationDomain.createAuditLog,

  // Utility methods
  initCsrfToken: () => httpClient.initCsrfToken(),
  setAccessToken: (token: string | null) => httpClient.setAccessToken(token),
};

// Utility functions
export function normalizeApiBaseUrl(url: string): string {
  // Remove trailing slash if present
  return url.replace(/\/$/, '');
}

// Default export for compatibility
export default apiClient;
