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
import * as subscriptionDomain from './domains/subscription';
import * as conversationDomain from './domains/conversation';
import * as shopDomain from './domains/shop';
import * as paymentDomain from './domains/payment';
import * as auditDomain from './domains/audit';

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
  testDeliveryConnection: orderDomain.testDeliveryConnection,

  // Customer methods
  getCustomers: customerDomain.getCustomers,
  getCustomer: customerDomain.getCustomer,
  createCustomer: customerDomain.createCustomer,
  updateCustomer: customerDomain.updateCustomer,
  blacklistCustomer: customerDomain.blacklistCustomer,
  removeFromBlacklist: customerDomain.removeFromBlacklist,
  deleteCustomer: customerDomain.deleteCustomer,

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

  // Shop methods
  getShopBusinessInfo: shopDomain.getShopBusinessInfo,
  updateShopBusinessInfo: shopDomain.updateShopBusinessInfo,
  getShopAISettings: shopDomain.getShopAISettings,
  updateShopAISettings: shopDomain.updateShopAISettings,
  getShop: shopDomain.getShop,
  updateShop: shopDomain.updateShop,

  // Payment config methods
  getPaymentConfig: paymentDomain.getPaymentConfig,
  updatePaymentConfig: paymentDomain.updatePaymentConfig,
  testPaymentConnection: paymentDomain.testPaymentConnection,
  deletePaymentConfig: paymentDomain.deletePaymentConfig,

  // Subscription invoice alias
  getSubscriptionInvoices: subscriptionDomain.getInvoices,
  purchaseConversationPack: subscriptionDomain.purchaseConversationPack,

  // Audit methods
  getAuditLogs: auditDomain.getAuditLogs,
  getResourceAuditLogs: auditDomain.getResourceAuditLogs,

  // Utility methods
  initCsrfToken: () => httpClient.initCsrfToken(),
  setAccessToken: (token: string | null) => httpClient.setAccessToken(token),

  // Raw HTTP passthrough — normalises paths that omit the /api prefix
  get: (url: string, config?: any) => httpClient.get(url.startsWith('/api/') ? url : `/api${url}`, config),
  post: (url: string, data?: any, config?: any) => httpClient.post(url.startsWith('/api/') ? url : `/api${url}`, data, config),
  put: (url: string, data?: any, config?: any) => httpClient.put(url.startsWith('/api/') ? url : `/api${url}`, data, config),
  delete: (url: string, config?: any) => httpClient.delete(url.startsWith('/api/') ? url : `/api${url}`, config),
};

// Utility functions
export function normalizeApiBaseUrl(url: string): string {
  // Remove trailing slash if present
  return url.replace(/\/$/, '');
}

// Default export for compatibility
export default apiClient;
