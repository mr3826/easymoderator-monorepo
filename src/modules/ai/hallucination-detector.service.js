'use strict';

/**
 * Hallucination Detector Service
 *
 * Stub implementation. Detects when an AI response is likely fabricated
 * (e.g., inventing product names, prices, or order details not in context).
 *
 * Production integration: compare response against retrieved RAG context
 * using semantic similarity. Flag responses with low grounding scores.
 */

const { createLogger } = require('../../utils/structured-logger');
const logger = createLogger('HallucinationDetector');

class HallucinationDetectorService {
    /**
     * Detect whether an AI response is likely a hallucination.
     *
     * @param {string} aiResponse - The AI-generated response text
     * @param {string} originalMessage - Customer's original message
     * @param {string} conversationId - Conversation ID for context lookup
     * @returns {{ likelyHallucination: boolean, confidence: number, description: string }}
     */
    async detect(aiResponse, originalMessage, conversationId) {
        try {
            // Heuristic checks — replace with RAG grounding score when available
            if (!aiResponse || typeof aiResponse !== 'string') {
                return { likelyHallucination: false, confidence: 0, description: 'No response to evaluate' };
            }

            // Flag suspiciously confident numeric claims with no context anchor
            const hasInventedNumbers = /\b(?:tk|taka|bdt)\s*[\d,]+/i.test(aiResponse) &&
                !/order|price|product|delivery/i.test(originalMessage);

            if (hasInventedNumbers) {
                logger.warn('Possible hallucinated price/amount in response', { conversationId });
                return {
                    likelyHallucination: true,
                    confidence: 0.6,
                    description: 'Response contains price/amount claims not anchored to order context'
                };
            }

            return { likelyHallucination: false, confidence: 0, description: 'No hallucination detected' };
        } catch (error) {
            logger.error('Hallucination detection error', { error: error.message });
            return { likelyHallucination: false, confidence: 0, description: 'Detection unavailable' };
        }
    }
}

module.exports = new HallucinationDetectorService();
