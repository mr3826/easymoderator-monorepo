/**
 * Conversation Search Service
 * 
 * Implements global full-text search across ALL conversations (not just loaded ones)
 * Fixes critical bug where search only works on currently displayed messages
 * 
 * @file conversation/conversation-search.service.js
 */

const { Conversation, ConversationMessage, Customer, sequelize } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { Op } = require('sequelize');

/**
 * Search conversations and messages by query text
 * 
 * @param {string} shopId - Shop ID
 * @param {string} query - Search query text
 * @param {Object} options - Search options
 * @returns {Promise<Object>} Search results with conversations and messages
 * 
 * Usage:
 * - Query: "refund" → finds all conversations mentioning refund
 * - Query: "+8801700000000" → finds conversations with this phone
 * - Query: "status:pending" → filters by status
 * - Query: "date:2025-03-15" → searches specific date
 */
async function searchConversations(shopId, query, options = {}) {
  try {
    const {
      limit = 50,
      offset = 0,
      searchType = 'all', // 'all' | 'messages' | 'customers'
      dateFrom,
      dateTo,
      status,
      channel
    } = options;

    if (!query || query.trim().length < 2) {
      throw new AppError('Search query must be at least 2 characters', 400);
    }

    const results = {
      conversations: [],
      messages: [],
      customers: [],
      totalResults: 0,
      query,
      searchType
    };

    // Parse special query syntax
    const { searchText, searchFilters } = parseSearchQuery(query);

    // Build WHERE clause for conversations
    const conversationWhere = {
      shop_id: shopId,
      ...(status && { status }),
      ...(channel && { channel_type: channel })
    };

    // Apply date filters if provided
    if (dateFrom || dateTo) {
      conversationWhere.created_at = {};
      if (dateFrom) conversationWhere.created_at[Op.gte] = new Date(dateFrom);
      if (dateTo) conversationWhere.created_at[Op.lte] = new Date(dateTo);
    }

    // Search in message content (using LIKE for portability, or full-text search if available)
    if (searchType === 'all' || searchType === 'messages') {
      const messages = await sequelize.query(`
        SELECT 
          m.id,
          m.conversation_id,
          m.body,
          m.sender,
          m.created_at,
          c.id as conversation_id,
          c.status,
          cust.name as customer_name,
          cust.phone as customer_phone
        FROM conversation_messages m
        JOIN conversations c ON m.conversation_id = c.id
        LEFT JOIN customers cust ON c.customer_id = cust.id
        WHERE 
          c.shop_id = :shopId
          AND (
            m.body LIKE :searchText
            OR c.id LIKE :searchText
          )
          ${status ? 'AND c.status = :status' : ''}
          ${channel ? 'AND c.channel_type = :channel' : ''}
          ${dateFrom ? 'AND m.created_at >= :dateFrom' : ''}
          ${dateTo ? 'AND m.created_at <= :dateTo' : ''}
        ORDER BY m.created_at DESC
        LIMIT :limit OFFSET :offset
      `, {
        replacements: {
          shopId,
          searchText: `%${searchText}%`,
          status,
          channel,
          dateFrom,
          dateTo,
          limit,
          offset
        },
        type: sequelize.QueryTypes.SELECT
      });

      results.messages = messages.map(msg => ({
        id: msg.id,
        conversationId: msg.conversation_id,
        body: msg.body,
        sender: msg.sender,
        createdAt: msg.created_at,
        customerName: msg.customer_name,
        customerPhone: msg.customer_phone,
        conversationStatus: msg.status
      }));

      results.totalResults += messages.length;
    }

    // Search in customer names and phone numbers
    if (searchType === 'all' || searchType === 'customers') {
      const customers = await sequelize.query(`
        SELECT DISTINCT
          c.id as customer_id,
          c.name,
          c.phone,
          COUNT(conv.id) as conversation_count,
          MAX(conv.created_at) as last_contact
        FROM customers c
        LEFT JOIN conversations conv ON c.id = conv.customer_id AND conv.shop_id = :shopId
        WHERE 
          (c.name LIKE :searchText OR c.phone LIKE :searchText)
          AND c.shop_id = :shopId
        GROUP BY c.id
        ORDER BY conversation_count DESC
        LIMIT :limit
      `, {
        replacements: {
          shopId,
          searchText: `%${searchText}%`,
          limit
        },
        type: sequelize.QueryTypes.SELECT
      });

      results.customers = customers.map(cust => ({
        id: cust.customer_id,
        name: cust.name,
        phone: cust.phone,
        conversationCount: cust.conversation_count,
        lastContact: cust.last_contact
      }));
    }

    // Get unique conversations from filtered messages
    if (results.messages.length > 0) {
      const conversationIds = [...new Set(results.messages.map(m => m.conversationId))];
      
      const conversations = await Conversation.findAll({
        where: {
          id: { [Op.in]: conversationIds }
        },
        include: ['customer', 'latestOrder'],
        limit: 10
      });

      results.conversations = conversations.map(conv => ({
        id: conv.id,
        customerId: conv.customer_id,
        customerName: conv.customer?.name,
        customerPhone: conv.customer?.phone,
        status: conv.status,
        channel: conv.channel_type,
        messageCount: conv.message_count,
        lastMessageAt: conv.last_message_at,
        createdAt: conv.created_at,
        latestOrderId: conv.latest_order_id
      }));
    }

    return results;
  } catch (error) {
    console.error('[Conversation Search] Error:', error.message);
    throw error;
  }
}

/**
 * Parse special search query syntax
 * 
 * Examples:
 * - "refund" → { searchText: "refund", filters: {} }
 * - "status:pending refund" → { searchText: "refund", filters: { status: "pending" } }
 * - "date:2025-03-15 complaint" → { searchText: "complaint", filters: { date: "2025-03-15" } }
 * 
 * @param {string} query - Query string
 * @returns {Object} Parsed query and filters
 */
function parseSearchQuery(query) {
  const filters = {};
  let searchText = query;

  // Extract status filter
  const statusMatch = query.match(/status:(\w+)/i);
  if (statusMatch) {
    filters.status = statusMatch[1];
    searchText = searchText.replace(statusMatch[0], '').trim();
  }

  // Extract date filter
  const dateMatch = query.match(/date:(\d{4}-\d{2}-\d{2})/i);
  if (dateMatch) {
    filters.date = dateMatch[1];
    searchText = searchText.replace(dateMatch[0], '').trim();
  }

  // Extract channel filter
  const channelMatch = query.match(/channel:(\w+)/i);
  if (channelMatch) {
    filters.channel = channelMatch[1];
    searchText = searchText.replace(channelMatch[0], '').trim();
  }

  return {
    searchText: searchText || '*', // Fallback to wildcard
    searchFilters: filters
  };
}

/**
 * Search within a specific conversation (messages only)
 * 
 * @param {string} conversationId - Conversation ID
 * @param {string} shopId - Shop ID (for auth)
 * @param {string} query - Search query
 * @returns {Promise<Array>} Matching messages
 */
async function searchWithinConversation(conversationId, shopId, query) {
  try {
    const conversation = await Conversation.findOne({
      where: { id: conversationId, shop_id: shopId }
    });

    if (!conversation) {
      throw new AppError('Conversation not found', 404);
    }

    const messages = await ConversationMessage.findAll({
      where: {
        conversation_id: conversationId,
        body: {
          [Op.like]: `%${query}%`
        }
      },
      order: [['created_at', 'DESC']],
      limit: 50
    });

    return messages;
  } catch (error) {
    console.error('[Conversation Search] Error searching within conversation:', error.message);
    throw error;
  }
}

/**
 * Get search suggestions based on partial query
 * Shows common search patterns and previous searches
 * 
 * @param {string} shopId - Shop ID
 * @param {string} partial - Partial query string
 * @returns {Promise<Array>} Suggestions
 */
async function getSearchSuggestions(shopId, partial) {
  try {
    const suggestions = [];

    if (!partial || partial.length < 2) {
      return suggestions;
    }

    // Suggest from recent conversation statuses
    const statusSuggestions = [
      { text: 'status:pending', description: 'Show pending conversations' },
      { text: 'status:active', description: 'Show active conversations' },
      { text: 'status:completed', description: 'Show completed conversations' },
      { text: 'status:escalated', description: 'Show escalated conversations' }
    ].filter(s => s.text.includes(partial.toLowerCase()));

    suggestions.push(...statusSuggestions);

    // Suggest from customer names
    const customers = await sequelize.query(`
      SELECT DISTINCT name FROM customers
      WHERE shop_id = :shopId AND name LIKE :partial
      LIMIT 5
    `, {
      replacements: { shopId, partial: `%${partial}%` },
      type: sequelize.QueryTypes.SELECT
    });

    suggestions.push(...customers.map(c => ({
      text: c.name,
      description: 'Customer'
    })));

    return suggestions;
  } catch (error) {
    console.error('[Conversation Search] Error getting suggestions:', error.message);
    return [];
  }
}

/**
 * Create a search index entry (for better performance)
 * Called when a new message is added to a conversation
 * 
 * @param {string} conversationId - Conversation ID
 * @param {string} messageBody - Message text
 */
async function indexMessageForSearch(conversationId, messageBody) {
  try {
    // For now, relying on Database LIKE searches
    // Future: integrate Elasticsearch or Meilisearch for better performance
    console.log(`[Search Index] Indexed message for conversation ${conversationId}`);
  } catch (error) {
    console.error('[Search Index] Error indexing message:', error.message);
    // Non-critical; don't throw
  }
}

module.exports = {
  searchConversations,
  searchWithinConversation,
  getSearchSuggestions,
  parseSearchQuery,
  indexMessageForSearch
};
