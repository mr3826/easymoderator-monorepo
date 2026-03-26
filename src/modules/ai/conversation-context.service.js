/**
 * Conversation Context Memory Enhancement
 * 
 * Fixes the critical bug where AI forgets previous messages in the same conversation.
 * Implements proper context window management for multi-turn conversations.
 * 
 * @file ai/conversation-context.service.js
 */

const { Conversation, ConversationMessage } = require('../entities');
const { AppError } = require('../../utils/AppError');

/**
 * CONTEXT STRATEGY:
 * 
 * 1. For each new AI request, load the LAST N MESSAGES from the conversation
 * 2. Include all relevant context (customer name, order details, previous questions)
 * 3. Pass full history to LLM prompt but only in summarized form for efficiency
 * 4. This prevents AI from losing context across messages
 * 
 * Window sizes:
 * - Small: 5 messages (for fast responses on simple queries)
 * - Medium: 10 messages (default, balances context & cost)
 * - Large: 20 messages (for complex multi-turn negotiations)
 */

const CONTEXT_CONFIG = {
  small: { maxMessages: 5, maxTokens: 1000 },
  medium: { maxMessages: 10, maxTokens: 2000 },
  large: { maxMessages: 20, maxTokens: 4000 }
};

/**
 * Build full conversation context for AI prompt injection
 * 
 * @param {string} conversationId - Conversation ID
 * @param {string} contextSize - 'small' | 'medium' | 'large'
 * @returns {Promise<Object>} Context object with conversation history
 */
async function buildConversationContext(conversationId, contextSize = 'medium') {
  try {
    // Fetch conversation metadata
    const conversation = await Conversation.findByPk(conversationId, {
      include: ['customer', 'latestOrder', 'channel']
    });

    if (!conversation) {
      throw new AppError('Conversation not found', 404);
    }

    const config = CONTEXT_CONFIG[contextSize] || CONTEXT_CONFIG.medium;

    // Fetch recent messages (ordered DESC, then reverse for chronological order)
    const messages = await ConversationMessage.findAll({
      where: { conversation_id: conversationId },
      order: [['created_at', 'DESC']],
      limit: config.maxMessages,
      raw: true
    });

    // Reverse to chronological order (oldest first)
    messages.reverse();

    // Build context object
    return {
      conversationId,
      customerId: conversation.customer_id,
      customerName: conversation.customer?.name || 'Customer',
      customerPhone: conversation.customer?.phone,
      conversationChannel: conversation.channel?.type || 'unknown',
      messageCount: conversation.message_count,
      lastMessageAt: conversation.last_message_at,
      status: conversation.status,
      latestOrderId: conversation.latest_order_id,
      messageHistory: formatMessageHistory(messages),
      summaryText: buildContextSummary(conversation, messages),
      hasOrders: !!conversation.latest_order_id
    };
  } catch (error) {
    console.error(`[Conversation Context] Error building context for ${conversationId}:`, error.message);
    return {
      conversationId,
      messageHistory: [],
      summaryText: 'Context unavailable',
      error: error.message
    };
  }
}

/**
 * Format message history into a readable format for LLM injection
 * 
 * @param {Array} messages - Array of conversation messages
 * @returns {string} Formatted message history
 */
function formatMessageHistory(messages) {
  if (!messages || messages.length === 0) {
    return '[No previous messages]';
  }

  return messages
    .map((msg, idx) => {
      const sender = msg.sender === 'customer' ? '👤 Customer' : '🤖 You';
      const timestamp = new Date(msg.created_at).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      return `${idx + 1}. [${timestamp}] ${sender}: ${msg.body}`;
    })
    .join('\n');
}

/**
 * Build natural language summary of conversation context
 * 
 * @param {Object} conversation - Conversation object
 * @param {Array} messages - Recent messages
 * @returns {string} Context summary text
 */
function buildContextSummary(conversation, messages) {
  const parts = [];

  // Customer info
  if (conversation.customer?.name) {
    parts.push(`Customer: ${conversation.customer.name}`);
  }

  // Recent activity
  if (messages.length > 0) {
    const lastMessage = messages[messages.length - 1];
    const isCustomer = lastMessage.sender === 'customer';
    const lastActor = isCustomer ? 'the customer' : 'you';
    parts.push(`Last message from ${lastActor} at ${new Date(lastMessage.created_at).toLocaleTimeString()}`);
  }

  // Order context
  if (conversation.latest_order_id) {
    parts.push(`Ongoing order in conversation`);
  }

  // Conversation status
  if (conversation.status && conversation.status !== 'active') {
    parts.push(`Status: ${conversation.status}`);
  }

  // Summary
  parts.push(`${messages.length} previous messages in this conversation`);

  return `Context: ${parts.join(' • ')}`;
}

/**
 * Inject conversation context into AI system prompt
 * 
 * This enhances the base system prompt with conversation-specific context
 * so the AI maintains memory of this conversation.
 * 
 * @param {string} basePrompt - Original system prompt
 * @param {Object} context - Context object from buildConversationContext()
 * @returns {string} Enhanced prompt with context injected
 */
function injectContextIntoPrompt(basePrompt, context) {
  if (!context || !context.messageHistory) {
    return basePrompt;
  }

  // Build context injection section
  const contextSection = `
## CONVERSATION CONTEXT (Reference for continuity)

${context.summaryText}

### Previous Messages in This Conversation:
\`\`\`
${context.messageHistory}
\`\`\`

### Instructions for this request:
- Consider all previous messages when forming your reply
- Refer back to earlier questions/statements for continuity
- If the customer mentioned something earlier, acknowledge it
- Maintain consistent tone and any agreements made
- If you provided information earlier, don't contradict it
`;

  // Inject after system prompt intro but before detailed instructions
  return basePrompt + contextSection;
}

/**
 * Extract key facts from conversation history
 * Used for creating better summaries and context
 * 
 * @param {Array} messages - Array of messages
 * @returns {Object} Extracted facts
 */
function extractContextFacts(messages) {
  const facts = {
    productsMentioned: [],
    priceAsked: false,
    quantityDiscussed: false,
    problemsReported: false,
    ordersPlaced: false
  };

  if (!messages) return facts;

  messages.forEach(msg => {
    const text = msg.body.toLowerCase();

    // Detect inquiries
    if (text.includes('price') || text.includes('cost') || text.includes('how much')) {
      facts.priceAsked = true;
    }
    if (text.includes('how many') || text.includes('quantity') || text.includes('count')) {
      facts.quantityDiscussed = true;
    }
    if (text.includes('problem') || text.includes('issue') || text.includes('broken') || text.includes('wrong')) {
      facts.problemsReported = true;
    }
    if (text.includes('confirm') || text.includes('confirm order') || text.includes('payment')) {
      facts.ordersPlaced = true;
    }
  });

  return facts;
}

/**
 * Decide optimal context window size based on conversation state
 * 
 * @param {Object} conversation - Conversation object
 * @returns {string} Recommended context size: 'small' | 'medium' | 'large'
 */
function autoSelectContextSize(conversation) {
  // Complex negotiations (many messages) need more context
  if (conversation.message_count > 15) {
    return 'large'; // 20 messages
  }

  // Simple inquiries don't need full history
  if (conversation.message_count < 5) {
    return 'small'; // 5 messages
  }

  // Default for most conversations
  return 'medium'; // 10 messages
}

/**
 * Mark conversation as "context_loaded" to optimize repeated requests
 * (This prevents re-processing the same context unnecessarily)
 */
async function updateConversationContextMetadata(conversationId, metadata) {
  try {
    await Conversation.update(
      {
        context_metadata: metadata,
        context_updated_at: new Date()
      },
      { where: { id: conversationId } }
    );
  } catch (error) {
    console.error(`[Conversation Context] Error updating metadata:`, error.message);
  }
}

module.exports = {
  buildConversationContext,
  injectContextIntoPrompt,
  formatMessageHistory,
  buildContextSummary,
  extractContextFacts,
  autoSelectContextSize,
  updateConversationContextMetadata,
  CONTEXT_CONFIG
};
