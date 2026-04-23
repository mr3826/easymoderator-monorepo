/**
 * Comment-to-DM Automation Service
 * 
 * Automatically converts Facebook page comments to Direct Messages (DMs)
 * Using Meta Graph API to monitor comments and create new conversations
 * 
 * Workflow:
 * 1. Listen for comment webhooks on Facebook page
 * 2. Check if comment is public/not already a reply to another comment
 * 3. Create new conversation in EasyMod
 * 4. Send welcome DM to customer
 * 5. Link conversation to customer profile
 * 
 * @file integration/comment-to-dm.service.js
 */

const axios = require('axios');
const { Conversation, Customer, Channel, Shop, Message } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger('CommentToDM');

/**
 * Process incoming comment webhook from Meta
 * Called when someone comments on shop's Facebook page
 * 
 * @param {Object} webhookData - Data from Meta webhook
 * @param {string} shopId - Shop ID
 */
async function processCommentWebhook(webhookData, shopId) {
  try {
    const { Subscription } = require('../entities');
    const { getTierByCode } = require('../subscription/subscription.plans');
    const subscription = await Subscription.findOne({ where: { shop_id: shopId } });
    const tier = getTierByCode(subscription?.plan_code);
    if (!tier?.features?.comment_auto_reply) {
      return { success: false, message: 'Comment-to-DM not available on current plan' };
    }

    const { entry } = webhookData;

    if (!entry || entry.length === 0) {
      logger.warn('Empty webhook entry');
      return { success: false, message: 'No entries' };
    }

    const results = [];

    for (const item of entry) {
      const { messaging } = item;

      if (!messaging) continue;

      for (const event of messaging) {
        if (event.comment) {
          const result = await handleCommentEvent(event, shopId);
          results.push(result);
        }
      }
    }

    return { success: true, results, count: results.length };
  } catch (error) {
    logger.error('Error processing comment webhook', { shopId, error });
    throw error;
  }
}

/**
 * Handle individual comment event
 * Creates conversation and sends welcome DM
 */
async function handleCommentEvent(event, shopId) {
  try {
    const {
      comment: { from, message: commentText, id: commentId, post }
    } = event;

    // Extract customer info
    const customerId = from?.id;
    const customerName = from?.name;

    if (!customerId || !commentText) {
      logger.warn('Comment missing required fields', { commentId });
      return { success: false, reason: 'missing_fields' };
    }

    // Check if we should process this comment
    // (Skip comments on comments, handled comments, etc.)
    const shouldProcess = await validateCommentForProcessing(commentId, shopId);
    if (!shouldProcess) {
      logger.info('Comment skipped due to validation', { commentId });
      return { success: false, reason: 'validation_failed' };
    }

    // Apply filter_type / keyword matching
    const config = await getCommentToDMConfig(shopId);
    if (!config.enabled) {
      return { success: false, reason: 'feature_disabled' };
    }
    if (config.filter_type === 'questions' && !commentText.includes('?')) {
      logger.info('Comment skipped — not a question', { commentId });
      return { success: false, reason: 'not_a_question' };
    }
    if (config.filter_type === 'keywords') {
      const lowerText = commentText.toLowerCase();
      const matched = config.trigger_keywords.some(kw => lowerText.includes(kw));
      if (!matched) {
        logger.info('Comment skipped — no keyword match', { commentId, keywords: config.trigger_keywords });
        return { success: false, reason: 'no_keyword_match' };
      }
    }

    // Get or create customer record
    const customer = await getOrCreateCustomer(shopId, customerId, customerName);

    // Get shop's Facebook channel
    const channel = await Channel.findOne({
      where: { shop_id: shopId, channel_type: 'messenger' }
    });

    if (!channel) {
      logger.warn('No messenger channel configured for shop', { shopId });
      return { success: false, reason: 'no_channel' };
    }

    // Create conversation from comment
    const conversation = await createConversationFromComment(
      shopId,
      customer.id,
      commentText,
      commentId,
      customerName
    );

    // Send welcome DM to customer
    await sendWelcomeDMToCustomer(shopId, customerId, customerName, channel);

    // Log the conversion
    logger.info('Comment converted to DM', {
      shopId,
      customerId,
      conversationId: conversation.id,
      commentId
    });

    return {
      success: true,
      conversationId: conversation.id,
      customerId,
      commentId
    };
  } catch (error) {
    logger.error('Error handling comment event', { shopId, error });
    return { success: false, error: error.message };
  }
}

/**
 * Validate that a comment should be processed
 * Skip: replies to comments, already processed, bot comments, etc.
 */
async function validateCommentForProcessing(commentId, shopId) {
  try {
    // Check if already processed
    const existing = await Message.findOne({
      where: { metadata: { external_message_id: commentId } }
    });

    if (existing) {
      return false; // Already processed
    }

    // Add more validation rules as needed
    // - Check if comment is reply to another comment
    // - Check if from bot/admin account
    // - Check comment length (skip very short comments)

    return true;
  } catch (error) {
    logger.warn('Error validating comment', { commentId, error });
    return false;
  }
}

/**
 * Get existing customer or create new one
 */
async function getOrCreateCustomer(shopId, facebookUserId, customerName) {
  try {
    let customer = await Customer.findOne({
      where: {
        shop_id: shopId,
        channel_type: 'messenger',
        channel_user_id: facebookUserId
      }
    });

    if (!customer) {
      customer = await Customer.create({
        shop_id: shopId,
        channel_type: 'messenger',
        channel_user_id: facebookUserId,
        name: customerName,
        last_active: new Date(),
        metadata: {
          source: 'comment_to_dm',
          created_from_comment: true
        }
      });

      logger.info('Created new customer from comment', {
        shopId,
        customerId: customer.id,
        facebookUserId
      });
    }

    return customer;
  } catch (error) {
    logger.error('Error creating/fetching customer', { shopId, facebookUserId, error });
    throw error;
  }
}

/**
 * Create conversation from comment
 * Sets up initial message thread
 */
async function createConversationFromComment(shopId, customerId, commentText, commentId, customerName) {
  try {
    const conversation = await Conversation.create({
      shop_id: shopId,
      customer_id: customerId,
      channel: 'messenger',
      title: `Message from ${customerName}`,
      status: 'active',
      role: 'user',
      message: commentText,
      metadata: {
        external_comment_id: commentId,
        source: 'facebook_comment',
        converted_to_dm: true,
        original_comment_text: commentText
      }
    });

    // Create initial message record
    const Message = require('../entities').Message;
    await Message.create({
      conversation_id: conversation.id,
      content: commentText,
      sender: 'customer',
      metadata: {
        external_message_id: commentId,
        source: 'facebook_comment'
      }
    });

    logger.info('Created conversation from comment', {
      shopId,
      conversationId: conversation.id,
      commentId
    });

    return conversation;
  } catch (error) {
    logger.error('Error creating conversation from comment', { shopId, error });
    throw error;
  }
}

/**
 * Send welcome DM to customer after comment conversion
 * Uses Meta Graph API to send initial message
 */
async function sendWelcomeDMToCustomer(shopId, facebookUserId, customerName, channel) {
  try {
    // Get shop AI settings for personalization
    const shop = await Shop.findByPk(shopId);
    const welcomeTemplate = shop?.settings?.ai?.comment_dm_welcome_template ||
      `Hi ${customerName}! 👋 Thanks for reaching out. I'm here to help with your questions about our products and services. How can I assist you today?`;

    // Get Meta access token from channel secrets
    if (!channel.secrets?.access_token) {
      logger.warn('No access token for sending DM', { shopId });
      return false;
    }

    // Send message via Meta Graph API
    const response = await axios.post(
      `https://graph.instagram.com/v18.0/me/messages`,
      {
        recipient: { id: facebookUserId },
        message: { text: welcomeTemplate }
      },
      {
        headers: {
          'Authorization': `Bearer ${channel.secrets.access_token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    logger.info('Welcome DM sent to customer', {
      shopId,
      facebookUserId,
      messageId: response.data?.message_id
    });

    return true;
  } catch (error) {
    logger.error('Error sending welcome DM', { shopId, facebookUserId, error });
    // Don't throw - this is non-critical
    return false;
  }
}

/**
 * Configure comment-to-DM automation for a shop
 * Enables/disables the feature, sets welcome message, filter type, and trigger keywords
 */
async function configureCommentToDM(shopId, config) {
  try {
    const { Subscription } = require('../entities');
    const { getTierByCode } = require('../subscription/subscription.plans');
    const subscription = await Subscription.findOne({ where: { shop_id: shopId } });
    const tier = getTierByCode(subscription?.plan_code);
    if (!tier?.features?.comment_auto_reply) {
      throw new AppError('Comment-to-DM is not available on your current plan. Upgrade to Growth or higher.', 403);
    }

    const shop = await Shop.findByPk(shopId);

    if (!shop) {
      throw new AppError('Shop not found', 404);
    }

    const settings = shop.settings || {};
    settings.ai = settings.ai || {};
    settings.ai.comment_to_dm_enabled = config.enabled !== false;

    if (config.welcomeTemplate !== undefined) {
      settings.ai.comment_dm_welcome_template = config.welcomeTemplate;
    }

    // filter_type: 'all' | 'questions' | 'keywords'
    if (config.filter_type !== undefined) {
      settings.ai.comment_dm_filter_type = config.filter_type;
    }

    // trigger_keywords: string[] — only used when filter_type === 'keywords'
    if (Array.isArray(config.trigger_keywords)) {
      settings.ai.comment_dm_trigger_keywords = config.trigger_keywords
        .map(k => k.trim().toLowerCase())
        .filter(k => k.length > 0);
    }

    shop.settings = settings;
    await shop.save();

    logger.info('Comment-to-DM configuration updated', {
      shopId, enabled: config.enabled, filterType: config.filter_type
    });

    return {
      success: true,
      enabled: settings.ai.comment_to_dm_enabled,
      welcomeTemplate: settings.ai.comment_dm_welcome_template,
      filter_type: settings.ai.comment_dm_filter_type || 'all',
      trigger_keywords: settings.ai.comment_dm_trigger_keywords || []
    };
  } catch (error) {
    logger.error('Error configuring comment-to-DM', { shopId, error });
    throw error;
  }
}

/**
 * Get comment-to-DM configuration for a shop
 */
async function getCommentToDMConfig(shopId) {
  try {
    const shop = await Shop.findByPk(shopId, {
      attributes: ['settings']
    });

    if (!shop) {
      throw new AppError('Shop not found', 404);
    }

    const aiSettings = shop.settings?.ai || {};

    return {
      enabled: aiSettings.comment_to_dm_enabled !== false,
      welcomeTemplate: aiSettings.comment_dm_welcome_template ||
        'Hi! 👋 Thanks for reaching out. How can I help you today?',
      filter_type: aiSettings.comment_dm_filter_type || 'all',
      trigger_keywords: aiSettings.comment_dm_trigger_keywords || ['price', 'দাম', 'কত', 'আছে']
    };
  } catch (error) {
    logger.error('Error fetching comment-to-DM config', { shopId, error });
    throw error;
  }
}

module.exports = {
  processCommentWebhook,
  handleCommentEvent,
  getOrCreateCustomer,
  createConversationFromComment,
  sendWelcomeDMToCustomer,
  configureCommentToDM,
  getCommentToDMConfig
};
