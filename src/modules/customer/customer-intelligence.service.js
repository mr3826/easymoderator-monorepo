/**
 * Customer Profile Intelligence Service
 * 
 * Tracks customer lifetime value (CLV), purchase history, and engagement metrics
 * Enables AI personalization and customer segmentation
 * 
 * Features:
 * - Calculate CLV based on purchase history
 * - Track purchase frequency and recency
 * - Identify VIP customers
 * - Personalization data for AI responses
 * - Churn prediction
 * 
 * @file customer/customer-intelligence.service.js
 */

const { Customer, Order, Conversation, Message, Shop } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');
const { Op } = require('sequelize');

const logger = createLogger('CustomerIntelligence');

/**
 * Calculate and update customer profile with intelligence metrics
 * Called periodically or after order creation
 * 
 * @param {string} customerId - Customer ID
 * @param {string} shopId - Shop ID
 */
async function updateCustomerProfile(customerId, shopId) {
  try {
    const customer = await Customer.findByPk(customerId);

    if (!customer || customer.shop_id !== shopId) {
      throw new AppError('Customer not found', 404);
    }

    // Calculate metrics
    const profile = await calculateCustomerMetrics(customerId, shopId);

    // Update customer metadata
    customer.metadata = customer.metadata || {};
    customer.metadata.intelligence = profile;
    customer.metadata.profile_updated_at = new Date().toISOString();

    await customer.save();

    logger.info('Customer profile updated', { customerId, shopId, clv: profile.clv });

    return profile;
  } catch (error) {
    logger.error('Error updating customer profile', { customerId, error });
    throw error;
  }
}

/**
 * Calculate all customer intelligence metrics
 */
async function calculateCustomerMetrics(customerId, shopId) {
  try {
    const [
      orders,
      conversations,
      customer
    ] = await Promise.all([
      Order.findAll({
        where: { customer_id: customerId, shop_id: shopId },
        attributes: ['id', 'total', 'payment_status', 'created_at']
      }),
      Conversation.findAll({
        where: { customer_id: customerId, shop_id: shopId },
        attributes: ['id', 'created_at', 'metadata']
      }),
      Customer.findByPk(customerId, {
        attributes: ['created_at', 'last_active']
      })
    ]);

    // Calculate metrics
    const clv = calculateCLV(orders);
    const purchaseMetrics = calculatePurchaseMetrics(orders);
    const engagementMetrics = calculateEngagementMetrics(conversations, customer);
    const segment = assignCustomerSegment(clv, purchaseMetrics, engagementMetrics);

    return {
      clv, // Customer Lifetime Value
      totalOrders: orders.length,
      totalSpent: purchaseMetrics.totalSpent,
      averageOrderValue: purchaseMetrics.averageOrderValue,
      purchaseFrequency: purchaseMetrics.frequency,
      purchaseRecency: purchaseMetrics.recency,
      purchaseHistory: purchaseMetrics.history,
      conversations: {
        total: conversations.length,
        ...engagementMetrics
      },
      segment,
      riskScore: calculateChurnRisk(purchaseMetrics, engagementMetrics),
      lastPurchase: purchaseMetrics.lastPurchase,
      firstPurchase: purchaseMetrics.firstPurchase,
      customerSince: customer?.created_at?.toISOString(),
      metrics_calculated_at: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Error calculating customer metrics', { customerId, error });
    throw error;
  }
}

/**
 * Calculate Customer Lifetime Value
 * Simple: Sum of all orders (can be enhanced with profit margins, refunds, etc.)
 */
function calculateCLV(orders) {
  const paidOrders = orders.filter(o => o.payment_status === 'paid' || o.payment_status === 'completed');
  const total = paidOrders.reduce((sum, order) => sum + (parseFloat(order.total) || 0), 0);
  return Math.round(total * 100) / 100; // 2 decimal places
}

/**
 * Calculate purchase-related metrics
 */
function calculatePurchaseMetrics(orders) {
  if (orders.length === 0) {
    return {
      totalSpent: 0,
      averageOrderValue: 0,
      frequency: 0,
      recency: null,
      history: [],
      lastPurchase: null,
      firstPurchase: null
    };
  }

  const paidOrders = orders
    .filter(o => o.payment_status === 'paid' || o.payment_status === 'completed')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const totalSpent = paidOrders.reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
  const averageOrderValue = totalSpent / paidOrders.length;

  // Purchase frequency: orders per month
  const firstOrder = new Date(paidOrders[paidOrders.length - 1]?.created_at);
  const lastOrder = new Date(paidOrders[0]?.created_at);
  const monthsBetween = (lastOrder - firstOrder) / (1000 * 60 * 60 * 24 * 30);
  const frequency = monthsBetween > 0 ? paidOrders.length / monthsBetween : paidOrders.length;

  // Purchase recency: days since last purchase
  const recency = Math.floor((Date.now() - lastOrder) / (1000 * 60 * 60 * 24));

  // History: last 10 purchases with dates and amounts
  const history = paidOrders.slice(0, 10).map(o => ({
    date: o.created_at,
    amount: parseFloat(o.total),
    status: o.payment_status
  }));

  return {
    totalSpent: Math.round(totalSpent * 100) / 100,
    averageOrderValue: Math.round(averageOrderValue * 100) / 100,
    frequency: Math.round(frequency * 100) / 100,
    recency,
    history,
    lastPurchase: lastOrder.toISOString(),
    firstPurchase: firstOrder.toISOString()
  };
}

/**
 * Calculate engagement metrics from conversations
 */
function calculateEngagementMetrics(conversations, customer) {
  if (conversations.length === 0) {
    return {
      totalConversations: 0,
      averageResponseTime: 0,
      engagementScore: 0,
      preferredChannel: null
    };
  }

  const engagementScore = Math.min(100, conversations.length * 10); // Simple scoring

  // Calculate response time (if available in metadata)
  let totalResponseTime = 0;
  let responseCount = 0;

  conversations.forEach(conv => {
    if (conv.metadata?.response_time) {
      totalResponseTime += conv.metadata.response_time;
      responseCount++;
    }
  });

  const averageResponseTime = responseCount > 0 ? totalResponseTime / responseCount : 0;

  return {
    totalConversations: conversations.length,
    averageResponseTime: Math.round(averageResponseTime),
    engagementScore: Math.round(engagementScore),
    lastContactDate: conversations[conversations.length - 1]?.created_at?.toISOString()
  };
}

/**
 * Assign customer segment based on metrics
 * Segments: vip, loyal, at_risk, dormant, new
 */
function assignCustomerSegment(clv, purchaseMetrics, engagementMetrics) {
  const { recency, frequency } = purchaseMetrics;
  const { engagementScore } = engagementMetrics;

  // VIP: High CLV and recent activity
  if (clv > 50000 && recency < 30) {
    return 'vip';
  }

  // Loyal: Consistent purchases with good engagement
  if (clv > 10000 && frequency > 2 && engagementScore > 50) {
    return 'loyal';
  }

  // At-risk: Previously engaged but inactive recently
  if (clv > 5000 && recency > 90 && engagementScore > 30) {
    return 'at_risk';
  }

  // Dormant: Old customer with no recent activity
  if (recency > 180) {
    return 'dormant';
  }

  // New: Recent customer with few purchases
  if (clv < 5000 && recency < 30) {
    return 'new';
  }

  return 'regular';
}

/**
 * Calculate churn risk score (0-100)
 * Higher score = higher risk of churn
 */
function calculateChurnRisk(purchaseMetrics, engagementMetrics) {
  let riskScore = 0;

  // Recency factor: days since last purchase (normalized to 0-100)
  // null/undefined = no purchase data → treat as 365 days; 0 = new customer (low risk)
  const effectiveRecency = (purchaseMetrics.recency === null || purchaseMetrics.recency === undefined) ? 365 : purchaseMetrics.recency;
  const recencyRisk = Math.min(100, effectiveRecency / 1.8);
  riskScore += recencyRisk * 0.6;

  // Frequency factor: if decreasing frequency
  const frequencyRisk = Math.max(0, 50 - (purchaseMetrics.frequency * 10));
  riskScore += frequencyRisk * 0.2;

  // Engagement factor: if low engagement score
  const engagementRisk = 100 - engagementMetrics.engagementScore;
  riskScore += engagementRisk * 0.2;

  return Math.round(riskScore);
}

/**
 * Get customer profile summary for API
 */
async function getCustomerProfile(customerId, shopId) {
  try {
    const customer = await Customer.findOne({
      where: { id: customerId, shop_id: shopId }
    });

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    const profile = customer.metadata?.intelligence || 
      await calculateCustomerMetrics(customerId, shopId);

    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      channelType: customer.channel_type,
      lastActive: customer.last_active,
      profile,
      riskLevel: profile.riskScore > 70 ? 'high' : 
                 profile.riskScore > 40 ? 'medium' : 'low'
    };
  } catch (error) {
    logger.error('Error getting customer profile', { customerId, error });
    throw error;
  }
}

/**
 * Get personalization data for AI to use in responses
 * Helps AI write personalized, contextual responses
 */
async function getPersonalizationData(customerId, shopId) {
  try {
    const profile = await getCustomerProfile(customerId, shopId);
    const { clv, lastPurchase, totalOrders, purchaseHistory } = profile.profile;

    // Build personalization context for AI
    const data = {
      isReturningCustomer: totalOrders > 1,
      isCorporateCustomer: clv > 100000,
      isVIP: profile.profile.segment === 'vip',
      isAtRisk: profile.profile.segment === 'at_risk',
      lastPurchaseDate: lastPurchase,
      totalSpent: profile.profile.totalSpent,
      previousProducts: purchaseHistory.map(h => h.date).slice(0, 3),
      personalizationTips: generatePersonalizationTips(profile)
    };

    return data;
  } catch (error) {
    logger.error('Error getting personalization data', { customerId, error });
    return {}; // Return empty if error - don't break conversation flow
  }
}

/**
 * Generate AI tips for personalizing response to this customer
 */
function generatePersonalizationTips(profile) {
  const tips = [];
  const { profile: p } = profile;

  if (p.segment === 'vip') {
    tips.push('This is a VIP customer - prioritize their satisfaction, offer exclusive deals');
  }

  if (p.segment === 'at_risk') {
    tips.push('This customer may be churning - show extra care, offer loyalty rewards');
  }

  if (p.totalOrders > 5) {
    tips.push(`This is a repeat customer with ${p.totalOrders} orders - reference their history if relevant`);
  }

  if (p.riskScore > 70) {
    tips.push('Customer churn risk is HIGH - be especially helpful and responsive');
  }

  if (p.clv > 50000) {
    tips.push(`High-value customer (${p.clv} taka spent) - prioritize support quality`);
  }

  return tips;
}

/**
 * Get customer segment distribution for a shop
 * Analytics: how many customers in each segment
 */
async function getSegmentDistribution(shopId) {
  try {
    const customers = await Customer.findAll({
      where: { shop_id: shopId },
      attributes: ['metadata']
    });

    const distribution = {
      vip: 0,
      loyal: 0,
      at_risk: 0,
      dormant: 0,
      new: 0,
      regular: 0,
      unanalyzed: 0
    };

    customers.forEach(customer => {
      const segment = customer.metadata?.intelligence?.segment;
      if (segment && distribution[segment] !== undefined) {
        distribution[segment]++;
      } else {
        distribution.unanalyzed++;
      }
    });

    const total = customers.length;
    const percentages = {};
    Object.keys(distribution).forEach(seg => {
      percentages[seg] = total > 0 ? Math.round((distribution[seg] / total) * 100) : 0;
    });

    return { distribution, percentages, total };
  } catch (error) {
    logger.error('Error getting segment distribution', { shopId, error });
    throw error;
  }
}

/**
 * Get customers at risk of churning (churn risk score > 70)
 * Useful for retention campaigns and proactive outreach
 */
async function getChurnRiskCustomers(shopId) {
  try {
    const customers = await Customer.findAll({
      where: { shop_id: shopId },
      attributes: ['id', 'name', 'email', 'phone', 'metadata']
    });

    const atRiskCustomers = customers
      .filter(c => {
        const riskScore = c.metadata?.intelligence?.riskScore || 0;
        return riskScore > 70;
      })
      .map(c => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        churnRisk: c.metadata?.intelligence?.riskScore || 0,
        segment: c.metadata?.intelligence?.segment || 'unknown',
        clv: c.metadata?.intelligence?.clv || 0,
        lastPurchase: c.metadata?.intelligence?.lastPurchase || null,
        recency: c.metadata?.intelligence?.purchaseRecency || null
      }))
      .sort((a, b) => b.churnRisk - a.churnRisk);

    return {
      customers: atRiskCustomers,
      totalAtRisk: atRiskCustomers.length,
      totalCustomers: customers.length,
      percentageAtRisk: customers.length > 0 ? Math.round((atRiskCustomers.length / customers.length) * 100) : 0
    };
  } catch (error) {
    logger.error('Error getting churn risk customers', { shopId, error });
    throw error;
  }
}

module.exports = {
  updateCustomerProfile,
  calculateCustomerMetrics,
  getCustomerProfile,
  getPersonalizationData,
  getSegmentDistribution,
  getChurnRiskCustomers,
  calculateCLV,
  calculateChurnRisk,
  assignCustomerSegment
};
