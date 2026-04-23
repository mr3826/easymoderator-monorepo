/**
 * LLM Tier-Based Selection Service
 * 
 * Automatically selects the best LLM model based on shop subscription tier.
 * This replaces user-facing model selection for transparency and cost optimization.
 * 
 * @file ai/llm-tier-selection.service.js
 */

const { Shop } = require('../entities');

/**
 * Map subscription tier to optimal LLM model configuration
 */
const TIER_MODEL_MAP = {
  'starter': {
    model: 'gemini-2.0-flash',
    reason: 'Fast, cost-effective for simple queries',
    maxTokens: 512,
    temperature: 0.3,
    provider: 'gemini',
    fallback: {
      model: 'gpt-4o-mini',
      reason: 'OpenAI fallback for reliability',
      maxTokens: 512,
      temperature: 0.3,
      provider: 'openai'
    }
  },
  'growth': {
    model: 'gemini-2.0-flash',
    reason: 'Balanced speed and cost with Gemini',
    maxTokens: 1024,
    temperature: 0.3,
    provider: 'gemini',
    fallback: {
      model: 'gpt-4o-mini',
      reason: 'OpenAI fallback for complex queries',
      maxTokens: 1024,
      temperature: 0.5,
      provider: 'openai'
    }
  },
  'scale': {
    model: 'gemini-1.5-pro',
    reason: 'Superior multimodal reasoning and context',
    maxTokens: 2048,
    temperature: 0.5,
    provider: 'gemini',
    fallback: {
      model: 'gpt-4o',
      reason: 'OpenAI GPT-4o fallback',
      maxTokens: 2048,
      temperature: 0.5,
      provider: 'openai'
    }
  },
  'enterprise': {
    model: 'gemini-1.5-pro',
    reason: 'Enterprise-grade Gemini with full context window',
    maxTokens: 4096,
    temperature: 0.5,
    provider: 'gemini',
    fallback: {
      model: 'gpt-4o',
      reason: 'OpenAI GPT-4o enterprise fallback',
      maxTokens: 4096,
      temperature: 0.5,
      provider: 'openai'
    }
  }
};

/**
 * Default tier if subscription info is missing
 */
const DEFAULT_TIER = 'starter';

/**
 * Get LLM model configuration for a shop based on tier
 * 
 * @param {string} shopId - Shop ID
 * @returns {Promise<Object>} Model configuration object
 */
async function selectLLMByTier(shopId) {
  try {
    // Fetch shop with subscription info
    const shop = await Shop.findByPk(shopId, {
      attributes: ['id', 'subscription_tier', 'subscription_plan']
    });

    if (!shop) {
      console.warn(`[LLM Selection] Shop ${shopId} not found, using default tier`);
      return getTierConfig(DEFAULT_TIER);
    }

    const tier = shop.subscription_tier || shop.subscription_plan || DEFAULT_TIER;
    return getTierConfig(tier.toLowerCase());
  } catch (error) {
    console.error(`[LLM Selection] Error fetching shop tier for ${shopId}:`, error.message);
    // Fallback to starter (cheapest, safest option)
    return getTierConfig(DEFAULT_TIER);
  }
}

/**
 * Get configuration for a specific tier
 * 
 * @param {string} tier - Subscription tier name
 * @returns {Object} Model configuration object
 */
function getTierConfig(tier) {
  const config = TIER_MODEL_MAP[tier] || TIER_MODEL_MAP[DEFAULT_TIER];
  
  return {
    ...config,
    tier,
    selectedAt: new Date().toISOString(),
    // Include telemetry for cost tracking
    costTier: calculateCostTier(tier)
  };
}

/**
 * Calculate cost tier for analytics/billing purposes
 * 
 * @param {string} tier - Subscription tier
 * @returns {Object} Cost information
 */
function calculateCostTier(tier) {
  const costMap = {
    'starter': { estimatedCostPerReq: 0.0001, costProfile: 'budget' },    // GPT-4o-mini ~$0.15/1M tokens
    'growth': { estimatedCostPerReq: 0.0002, costProfile: 'balanced' },   // Mix of models
    'scale': { estimatedCostPerReq: 0.0003, costProfile: 'premium' },     // Claude with caching
    'enterprise': { estimatedCostPerReq: 0.0004, costProfile: 'enterprise' } // Full features
  };
  
  return costMap[tier] || costMap['starter'];
}

/**
 * Handle intent-based model override (rare cases where specific model is needed)
 * 
 * For complex reasoning intents (e.g., complaint resolution), fall back to better model
 * if available in tier's fallback configuration.
 * 
 * @param {string} shopId - Shop ID
 * @param {string} intent - Detected intent (e.g., 'complaint', 'negotiation')
 * @returns {Promise<Object>} Model configuration object
 */
async function selectLLMByIntentAndTier(shopId, intent) {
  const tierConfig = await selectLLMByTier(shopId);
  
  // High-reasoning intents use the tier's OpenAI fallback for reliability
  const reasoningIntents = ['complaint', 'negotiation', 'dispute', 'escalation'];

  if (reasoningIntents.includes(intent) && tierConfig.fallback) {
    return {
      ...tierConfig.fallback,
      tier: tierConfig.tier,
      selectedAt: new Date().toISOString(),
      reason: `${tierConfig.fallback.reason} (due to ${intent} intent)`,
      intentOverride: true
    };
  }
  
  return tierConfig;
}

/**
 * Validate that a model choice is allowed for a shop's tier
 * (Used for admin override scenarios)
 * 
 * @param {string} shopId - Shop ID
 * @param {string} requestedModel - Requested model
 * @returns {Promise<boolean>} True if allowed
 */
async function isModelAllowedForTier(shopId, requestedModel) {
  try {
    const allowedModels = {
      'starter': ['gemini-2.0-flash', 'gpt-4o-mini'],
      'growth': ['gemini-2.0-flash', 'gpt-4o-mini', 'gpt-4o'],
      'scale': ['gemini-1.5-pro', 'gemini-2.0-flash', 'gpt-4o'],
      'enterprise': ['gemini-1.5-pro', 'gemini-2.0-flash', 'gpt-4o']
    };

    const shop = await Shop.findByPk(shopId, {
      attributes: ['subscription_tier']
    });

    const tier = shop?.subscription_tier || DEFAULT_TIER;
    const allowed = allowedModels[tier.toLowerCase()] || allowedModels[DEFAULT_TIER];

    return allowed.includes(requestedModel);
  } catch (error) {
    console.error(`[LLM Selection] Error validating model for tier:`, error.message);
    return false; // Deny by default if error
  }
}

/**
 * Get all tier configurations (for admin/analytics dashboard)
 * 
 * @returns {Object} Map of all tier configurations
 */
function getAllTierConfigs() {
  return TIER_MODEL_MAP;
}

/**
 * Format tier selection info for logging/debugging
 * 
 * @param {string} shopId - Shop ID
 * @param {Object} config - Configuration object from selectLLMByTier
 * @returns {string} Formatted info string
 */
function formatTierSelectionInfo(shopId, config) {
  return `[${shopId}] Tier: ${config.tier} | Model: ${config.model} | Provider: ${config.provider} | Reason: ${config.reason}`;
}

module.exports = {
  selectLLMByTier,
  selectLLMByIntentAndTier,
  getTierConfig,
  calculateCostTier,
  isModelAllowedForTier,
  getAllTierConfigs,
  formatTierSelectionInfo,
  TIER_MODEL_MAP,
  DEFAULT_TIER
};
