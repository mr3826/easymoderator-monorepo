// src/modules/ai/auto-approve.service.update.js
// TASK 3 (Part 2): Auto-Approve Service - Cost Cap Enforcement
// Purpose: Update auto-approve to enforce 2 LLM calls per message limit
// Owner: Backend Dev
// Effort: 0.5 days (integrated into existing auto-approve.service.js)
// Deadline: End of Day 2

/**
 * ADD THIS METHOD TO EXISTING auto-approve.service.js
 * 
 * This enforces the cost cap logic:
 * - If llmCallCount >= 2, escalate (don't retry)
 * - If llmCallCount < 2, allow next LLM call
 * - Track call count in message.metadata.llmCallCount
 */

class AutoApproveServiceUpdate {
  /**
   * CHECK IF MESSAGE HAS EXCEEDED COST CAP
   * 
   * Called BEFORE each LLM call to decide: proceed or escalate?
   * 
   * @param message - Message object with { id, metadata, conversationId, shopId }
   * @returns { canCallLLM, reason, callCount }
   */
  async shouldCallLLMAgain(message) {
    const callCount = message.metadata?.llmCallCount || 0;

    // RULE 1: If already called LLM twice, escalate
    if (callCount >= 2) {
      this.logger.warn(
        `[COST_CAP] Message ${message.id} has already used 2 LLM calls. Escalating.`
      );
      return {
        canCallLLM: false,
        reason: 'COST_CAP_EXCEEDED',
        callCount,
        action: 'ESCALATE_TO_HUMAN'
      };
    }

    // RULE 2: If called once, allow retry but log it
    if (callCount === 1) {
      this.logger.info(
        `[COST_CAP] Message ${message.id} is on 2nd LLM call (final attempt). ` +
        `If this fails, will escalate.`
      );
      return {
        canCallLLM: true,
        reason: 'FINAL_LLM_ATTEMPT',
        callCount,
        action: 'ALLOW_WITH_ESCALATION_BACKUP'
      };
    }

    // RULE 3: First call is always allowed
    this.logger.debug(`[COST_CAP] Message ${message.id} is on 1st LLM call`);
    return {
      canCallLLM: true,
      reason: 'FIRST_CALL_ALLOWED',
      callCount,
      action: 'ALLOW'
    };
  }

  /**
   * INCREMENT LLM CALL COUNTER
   * 
   * Called AFTER each LLM call to update metadata
   * 
   * @param message - Message to update
   * @returns { newCount, costCapReached }
   */
  async incrementLLMCallCount(message) {
    const oldCount = message.metadata?.llmCallCount || 0;
    const newCount = oldCount + 1;

    // Update metadata
    message.metadata = message.metadata || {};
    message.metadata.llmCallCount = newCount;

    // Update database
    await this.messageRepository.update(message.id, {
      metadata: message.metadata,
      cost_cap_status: newCount >= 2 ? 'LLM_CALLS_2' : 'LLM_CALLS_1'
    });

    this.logger.info(
      `[COST_CAP] Incremented LLM call count for message ${message.id}: ${oldCount} → ${newCount}`
    );

    return {
      newCount,
      costCapReached: newCount >= 2
    };
  }

  /**
   * INTEGRATION: Call this in your message processing pipeline
   * 
   * Pseudocode for ai-chatbot.controller.js:
   * 
   * async processMessage(req, res) {
   *   const { conversationId, messageText } = req.body;
   *   
   *   // 1. Create/get message record
   *   let message = await this.messageRepository.create({
   *     conversationId,
   *     content: messageText,
   *     metadata: { llmCallCount: 0 },
   *     cost_cap_status: 'PENDING'
   *   });
   *   
   *   try {
   *     // 2. Check if we can call LLM
   *     const costCapCheck = await this.autoApproveService.shouldCallLLMAgain(message);
   *     
   *     if (!costCapCheck.canCallLLM) {
   *       // Escalate immediately
   *       await this.guardrailService.handleFailure({
   *         messageId: message.id,
   *         reason: 'COST_CAP_EXCEEDED',
   *         escalationType: 'COST_LIMIT'
   *       });
   *       
   *       return res.status(429).json({
   *         status: 'ESCALATED',
   *         reason: 'Cost cap exceeded, escalated to human review'
   *       });
   *     }
   *     
   *     // 3. Call LLM
   *     const llmResponse = await this.llmService.callLLMWithLatencyAwareFailover(
   *       messageText,
   *       conversationContext,
   *       shopId
   *     );
   *     
   *     // 4. Increment counter
   *     await this.autoApproveService.incrementLLMCallCount(message);
   *     message = await this.messageRepository.find(message.id);
   *     
   *     // 5. Check confidence + guardrails
   *     const confidence = await this.autoApproveService.calculateConfidence(llmResponse);
   *     if (confidence >= 85) {
   *       // Auto-approve and send
   *       await this.messageRepository.update(message.id, {
   *         response: llmResponse,
   *         confidence,
   *         cost_cap_status: costCapCheck.callCount >= 1 ? 'RESOLVED' : 'PENDING',
   *         auto_approved: true
   *       });
   *       return res.json({ status: 'SENT', response: llmResponse });
   *     }
   *     
   *     // 6. Low confidence
   *     // Check if we can retry OR must escalate
   *     if (message.metadata.llmCallCount >= 2) {
   *       // Already tried twice, escalate
   *       await this.guardrailService.handleFailure({...});
   *       return res.status(202).json({ status: 'ESCALATED' });
   *     }
   *     
   *     // Can retry
   *     return res.status(202).json({
   *       status: 'LOW_CONFIDENCE_RETRY',
   *       attemptsRemaining: 1
   *     });
   *     
   *   } catch (error) {
   *     this.logger.error(`Message processing error: ${error.message}`);
   *     
   *     // After error, increment counter
   *     await this.autoApproveService.incrementLLMCallCount(message);
   *     
   *     // Check if should retry or escalate
   *     if (message.metadata.llmCallCount >= 2) {
   *       // Escalate
   *       await this.guardrailService.handleFailure({
   *         messageId: message.id,
   *         reason: error.message,
   *         escalationType: 'REPEATED_FAILURE'
   *       });
   *       return res.status(202).json({ status: 'ESCALATED' });
   *     }
   *     
   *     // Retry
   *     return res.status(202).json({ status: 'RETRY', attemptNumber: 2 });
   *   }
   * }
   */
}

module.exports = AutoApproveServiceUpdate;

/**
 * DATABASE VERIFICATION QUERIES
 * 
 * After deploying this change, verify with:
 * 
 * 1. Check metadata structure:
 *    SELECT id, metadata FROM messages LIMIT 5;
 *    Expected: metadata has { llmCallCount: 0, 1, or 2 }
 * 
 * 2. Find messages that hit cost cap:
 *    SELECT id, cost_cap_status, metadata FROM messages
 *    WHERE cost_cap_status = 'LLM_CALLS_2' OR JSON_EXTRACT(metadata, '$.llmCallCount') >= 2;
 * 
 * 3. Check escalations due to cost cap:
 *    SELECT m.id, m.cost_cap_status, c.hitl FROM messages m
 *    JOIN conversations c ON m.conversation_id = c.id
 *    WHERE c.hitl = true AND m.cost_cap_status = 'ESCALATED';
 */
