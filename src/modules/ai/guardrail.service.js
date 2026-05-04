'use strict';

const { createLogger } = require('../../utils/structured-logger');
const rtoShieldService = require('../rto-shield/rto-shield.service');
const promptSanitizerService = require('./prompt-sanitizer.service');
const hallucinationDetectorService = require('./hallucination-detector.service');
const opsAlertService = require('./ops-alert.service');

const logger = createLogger('GuardrailService');

class GuardrailService {
    /**
     * Run all guardrails on an AI response before it is sent to the customer.
     *
     * @param {string} aiResponse - The generated AI response text
     * @param {string} originalMessage - Customer's original message
     * @param {string} conversationId - Conversation context
     * @param {string} shopId - Shop context
     * @returns {{ pass, violations, maxSeverity, requiresEscalation, checksRun, executionTimeMs }}
     */
    async validateResponse(aiResponse, originalMessage, conversationId, shopId) {
        const violations = [];
        const startTime = Date.now();

        // Guard 1: RTO Fraud Detection (BD-specific)
        try {
            logger.debug(`[Guard 1] Running RTO fraud check for shop ${shopId}`);
            const rtoCheck = await rtoShieldService.checkPhoneFraud(originalMessage, shopId);
            if (!rtoCheck.pass) {
                violations.push({
                    type: 'RTO_FRAUD_DETECTED',
                    severity: 'HIGH',
                    reason: rtoCheck.reason,
                    riskScore: rtoCheck.score,
                    guardType: 'RTO_SHIELD'
                });
                logger.warn('RTO fraud detected', { conversationId, riskScore: rtoCheck.score });
            }
        } catch (error) {
            logger.error('RTO fraud check failed', { error: error.message });
        }

        // Guard 2: Prompt Injection Detection
        try {
            logger.debug('[Guard 2] Running prompt injection check');
            const sanitizationCheck = promptSanitizerService.sanitize(originalMessage);
            if (!sanitizationCheck.clean) {
                violations.push({
                    type: 'PROMPT_INJECTION_ATTEMPT',
                    severity: 'HIGH',
                    reason: 'Malicious prompt pattern detected',
                    pattern: sanitizationCheck.detectedPattern,
                    guardType: 'PROMPT_SANITIZER'
                });
                logger.warn('Prompt injection attempt detected', {
                    conversationId,
                    pattern: sanitizationCheck.detectedPattern
                });
            }
        } catch (error) {
            logger.error('Prompt injection check failed', { error: error.message });
        }

        // Guard 3: Hallucination Detection
        try {
            logger.debug('[Guard 3] Running hallucination detection');
            const hallucCheck = await hallucinationDetectorService.detect(
                aiResponse,
                originalMessage,
                conversationId
            );
            if (hallucCheck.likelyHallucination) {
                violations.push({
                    type: 'HALLUCINATION_LIKELY',
                    severity: 'MEDIUM',
                    confidence: hallucCheck.confidence,
                    reason: hallucCheck.description,
                    guardType: 'HALLUCINATION_DETECTOR'
                });
                logger.warn('Likely hallucination detected', {
                    conversationId,
                    confidence: hallucCheck.confidence,
                    reason: hallucCheck.description
                });
            }
        } catch (error) {
            logger.error('Hallucination check failed', { error: error.message });
        }

        // Guard 4: Response Coherence & Length Check
        try {
            logger.debug('[Guard 4] Running response coherence check');
            if (!aiResponse || typeof aiResponse !== 'string') {
                violations.push({
                    type: 'RESPONSE_NULL_OR_INVALID',
                    severity: 'HIGH',
                    reason: 'Response is null or not a string',
                    guardType: 'COHERENCE_CHECK'
                });
                logger.warn('Response null/invalid', { conversationId });
            } else if (aiResponse.length < 10) {
                violations.push({
                    type: 'RESPONSE_TOO_SHORT',
                    severity: 'MEDIUM',
                    reason: `Response too short (${aiResponse.length} chars)`,
                    guardType: 'COHERENCE_CHECK'
                });
            } else if (aiResponse.length > 4000) {
                violations.push({
                    type: 'RESPONSE_TOO_LONG',
                    severity: 'MEDIUM',
                    reason: `Response too long (${aiResponse.length} chars)`,
                    guardType: 'COHERENCE_CHECK'
                });
            }
        } catch (error) {
            logger.error('Coherence check failed', { error: error.message });
        }

        // Guard 5: Toxicity Check (optional — stub returns 0.1)
        try {
            logger.debug('[Guard 5] Running toxicity check');
            const toxicityScore = await this._checkToxicity(aiResponse);
            if (toxicityScore > 0.7) {
                violations.push({
                    type: 'TOXIC_LANGUAGE_DETECTED',
                    severity: 'MEDIUM',
                    confidence: toxicityScore,
                    reason: 'Response contains offensive language',
                    guardType: 'TOXICITY_CHECK'
                });
                logger.warn('Toxic language detected', { conversationId, score: toxicityScore });
            }
        } catch (error) {
            logger.debug('Toxicity check not available (optional)', { error: error.message });
        }

        const severityMap = { LOW: 1, MEDIUM: 2, HIGH: 3 };
        const maxSeverityValue = violations.length > 0
            ? Math.max(...violations.map(v => severityMap[v.severity] || 0))
            : 0;
        const maxSeverity = Object.keys(severityMap).find(k => severityMap[k] === maxSeverityValue) || 'LOW';

        const result = {
            pass: violations.length === 0,
            violations,
            maxSeverity,
            requiresEscalation: violations.some(v => v.severity === 'HIGH'),
            checksRun: 5,
            executionTimeMs: Date.now() - startTime
        };

        logger.info('Guardrail validation complete', {
            conversationId,
            pass: result.pass,
            violationCount: violations.length,
            executionMs: result.executionTimeMs
        });

        return result;
    }

    /**
     * Handle guardrail failure by escalating conversation to human review (HITL).
     */
    async handleFailure(violations, conversationId, shopId, originalMessage, aiResponse) {
        const { Conversation } = require('../conversation/conversation.entity');

        const escalation = {
            conversationId,
            shopId,
            timestamp: new Date(),
            violations: violations.map(v => ({
                type: v.type,
                severity: v.severity,
                reason: v.reason,
                guardType: v.guardType
            })),
            status: 'PENDING_REVIEW',
            handledBy: null,
            approvalTime: null,
            context: {
                guardrailReasons: violations.map(v => v.type).join(', ')
            }
        };

        try {
            const conversation = await Conversation.findByPk(conversationId);
            if (!conversation) throw new Error(`Conversation ${conversationId} not found`);

            await conversation.update({
                hitl: true,
                metadata: {
                    ...conversation.metadata,
                    escalation,
                    escalation_time: new Date(),
                    escalation_reason: escalation.context.guardrailReasons,
                    needs_human_review: true
                }
            });

            logger.warn('ESCALATION CREATED', {
                conversationId,
                shopId,
                violationTypes: violations.map(v => v.type),
                reason: escalation.context.guardrailReasons
            });

            try {
                await opsAlertService.sendEscalationAlert({
                    type: 'GUARDRAIL_ESCALATION',
                    conversationId,
                    shopId,
                    violations: escalation.violations,
                    customerMessage: originalMessage,
                    aiResponse,
                    priority: violations.some(v => v.severity === 'HIGH') ? 'HIGH' : 'MEDIUM'
                });
            } catch (alertError) {
                logger.error('Failed to send ops alert', { error: alertError.message, conversationId });
            }

            return escalation;
        } catch (error) {
            logger.error('Failed to handle guardrail failure', { error: error.message, conversationId });
            throw error;
        }
    }

    /**
     * Get current escalation status for a conversation.
     */
    async getEscalationStatus(conversationId) {
        const { Conversation } = require('../conversation/conversation.entity');
        try {
            const conversation = await Conversation.findByPk(conversationId);
            if (!conversation || !conversation.hitl || !conversation.metadata?.escalation) {
                return null;
            }
            const esc = conversation.metadata.escalation;
            return {
                conversationId,
                status: esc.status,
                violations: esc.violations,
                timestamp: esc.timestamp,
                handledBy: esc.handledBy,
                approvalTime: esc.approvalTime
            };
        } catch (error) {
            logger.error('Failed to get escalation status', { error: error.message });
            return null;
        }
    }

    /**
     * Approve an escalated conversation (ops action). Clears HITL flag.
     */
    async approveEscalation(conversationId, approverUserId, approverNotes) {
        const { Conversation } = require('../conversation/conversation.entity');
        const conversation = await Conversation.findByPk(conversationId);
        if (!conversation) throw new Error(`Conversation ${conversationId} not found`);
        if (!conversation.hitl) throw new Error('Conversation not in HITL mode');

        await conversation.update({
            hitl: false,
            metadata: {
                ...conversation.metadata,
                escalation: {
                    ...conversation.metadata.escalation,
                    status: 'APPROVED',
                    handledBy: approverUserId,
                    approvalTime: new Date(),
                    approverNotes
                }
            }
        });

        logger.info('Escalation approved', { conversationId, approverUserId });
        return { status: 'APPROVED' };
    }

    /**
     * Reject an escalated conversation (ops action). Clears HITL flag.
     */
    async rejectEscalation(conversationId, approverUserId, rejectReason) {
        const { Conversation } = require('../conversation/conversation.entity');
        const conversation = await Conversation.findByPk(conversationId);
        if (!conversation) throw new Error(`Conversation ${conversationId} not found`);
        if (!conversation.hitl) throw new Error('Conversation not in HITL mode');

        await conversation.update({
            hitl: false,
            metadata: {
                ...conversation.metadata,
                escalation: {
                    ...conversation.metadata.escalation,
                    status: 'REJECTED',
                    handledBy: approverUserId,
                    approvalTime: new Date(),
                    rejectReason
                }
            }
        });

        logger.info('Escalation rejected', { conversationId, approverUserId, reason: rejectReason });
        return { status: 'REJECTED' };
    }

    /**
     * Toxicity score check (0–1 scale).
     * Uses keyword-based pattern matching as a baseline filter.
     * Production-grade solution: integrate Google Perspective API or OpenAI Moderation API.
     *
     * @param {string} text - Text to evaluate
     * @returns {number} Score 0 (clean) to 0.9 (very toxic)
     */
    _checkToxicity(text) {
        // TODO: replace with Google Perspective API or OpenAI Moderation for production accuracy
        const toxicPatterns = [
            /fuck|shit|ass|bitch|cunt|bastard|damn|hell/i,
            /kill|murder|suicide|rape|abuse/i,
        ];
        const matches = toxicPatterns.filter(p => p.test(text)).length;
        return Math.min(matches * 0.3, 0.9); // 0 = clean, 0.9 = very toxic
    }
}

module.exports = new GuardrailService();
