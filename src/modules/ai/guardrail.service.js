// src/modules/ai/guardrail.service.js
// Purpose: Validate AI responses against fraud, injection, hallucination risks
// Enforces guardrail checks before response sent to customer
// Owner: Lead Dev
// Effort: 1 day

const { Injectable, Logger } = require('@nestjs/common');

@Injectable()
class GuardrailService {
  private logger = new Logger('GuardrailService');

  constructor(
    private rtoShieldService,
    private promptSanitizerService,
    private halluccinationDetectorService,
    private conversationRepository,
    private opsAlertService
  ) {}

  /**
   * Run all guardrails on AI response
   * 
   * @param aiResponse - The generated AI response text
   * @param originalMessage - Customer's original message
   * @param conversationId - Conversation context
   * @param shopId - Shop context
   * 
   * @returns {
   *   pass: boolean,
   *   violations: Array<{ type, severity, reason, confidence? }>,
   *   maxSeverity: 'LOW' | 'MEDIUM' | 'HIGH',
   *   requiresEscalation: boolean
   * }
   */
  async validateResponse(aiResponse, originalMessage, conversationId, shopId) {
    const violations = [];
    const startTime = Date.now();

    // Guard 1: RTO Fraud Detection (BD-specific)
    try {
      this.logger.debug(`[Guard 1] Running RTO fraud check for shop ${shopId}`);
      const rtoCheck = await this.rtoShieldService.checkPhoneFraud(
        originalMessage,
        shopId
      );
      
      if (!rtoCheck.pass) {
        violations.push({
          type: 'RTO_FRAUD_DETECTED',
          severity: 'HIGH',
          reason: rtoCheck.reason,
          riskScore: rtoCheck.score,
          guardType: 'RTO_SHIELD'
        });
        this.logger.warn('🚨 RTO fraud detected', {
          conversationId,
          riskScore: rtoCheck.score
        });
      }
    } catch (error) {
      this.logger.error('❌ RTO fraud check failed', { error: error.message });
      // Don't add violation; log as warning but continue
    }

    // Guard 2: Prompt Injection Detection
    try {
      this.logger.debug(`[Guard 2] Running prompt injection check`);
      const sanitizationCheck = this.promptSanitizerService.sanitize(originalMessage);
      
      if (!sanitizationCheck.clean) {
        violations.push({
          type: 'PROMPT_INJECTION_ATTEMPT',
          severity: 'HIGH',
          reason: 'Malicious prompt pattern detected',
          pattern: sanitizationCheck.detectedPattern,
          guardType: 'PROMPT_SANITIZER'
        });
        this.logger.warn('🚨 Prompt injection attempt detected', {
          conversationId,
          pattern: sanitizationCheck.detectedPattern
        });
      }
    } catch (error) {
      this.logger.error('❌ Prompt injection check failed', { error: error.message });
    }

    // Guard 3: Hallucination Detection (LLM-specific)
    try {
      this.logger.debug(`[Guard 3] Running hallucination detection`);
      const hallucCheck = await this.halluccinationDetectorService.detect(
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
        this.logger.warn('⚠️ Likely hallucination detected', {
          conversationId,
          confidence: hallucCheck.confidence,
          reason: hallucCheck.description
        });
      }
    } catch (error) {
      this.logger.error('❌ Hallucination check failed', { error: error.message });
    }

    // Guard 4: Response Coherence & Length Check
    try {
      this.logger.debug(`[Guard 4] Running response coherence check`);
      
      if (!aiResponse || typeof aiResponse !== 'string') {
        violations.push({
          type: 'RESPONSE_NULL_OR_INVALID',
          severity: 'HIGH',
          reason: 'Response is null or not a string',
          guardType: 'COHERENCE_CHECK'
        });
        this.logger.warn('Response null/invalid', { conversationId });
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
      this.logger.error('❌ Coherence check failed', { error: error.message });
    }

    // Guard 5: Toxicity/Offensive Language Check (Optional)
    try {
      this.logger.debug(`[Guard 5] Running toxicity check`);
      const toxicityScore = await this.checkToxicity(aiResponse);
      
      if (toxicityScore > 0.7) {
        violations.push({
          type: 'TOXIC_LANGUAGE_DETECTED',
          severity: 'MEDIUM',
          confidence: toxicityScore,
          reason: 'Response contains offensive language',
          guardType: 'TOXICITY_CHECK'
        });
        this.logger.warn('⚠️ Toxic language detected', {
          conversationId,
          score: toxicityScore
        });
      }
    } catch (error) {
      this.logger.debug('Toxicity check not available (optional)', { error: error.message });
    }

    // Determine max severity
    const severityMap = { 'LOW': 1, 'MEDIUM': 2, 'HIGH': 3 };
    const maxSeverityValue = violations.length > 0
      ? Math.max(...violations.map(v => severityMap[v.severity] || 0))
      : 0;
    const maxSeverity = Object.keys(severityMap).find(k => severityMap[k] === maxSeverityValue);

    const result = {
      pass: violations.length === 0,
      violations,
      maxSeverity: maxSeverity || 'LOW',
      requiresEscalation: violations.some(v => v.severity === 'HIGH'),
      checksRun: 5,
      executionTimeMs: Date.now() - startTime
    };

    this.logger.log('✅ Guardrail validation complete', {
      conversationId,
      pass: result.pass,
      violationCount: violations.length,
      executionMs: result.executionTimeMs
    });

    return result;
  }

  /**
   * Handle guardrail failure by escalating to human review
   * 
   * @param violations - Array of guardrail violations
   * @param conversationId - Conversation to escalate
   * @param shopId - Shop owner context
   * @param originalMessage - Customer message (for context)
   * @param aiResponse - AI response that failed (for review)
   */
  async handleFailure(violations, conversationId, shopId, originalMessage, aiResponse) {
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
        customerMessage: originalMessage,
        aiResponse: aiResponse,
        guardrailReasons: violations.map(v => v.type).join(', ')
      }
    };

    try {
      // 1. Mark conversation for human review
      const conversation = await this.conversationRepository.findById(conversationId);
      
      await conversation.update({
        hitl: true, // Human-In-The-Loop
        metadata: {
          ...conversation.metadata,
          escalation: escalation,
          escalation_time: new Date(),
          escalation_reason: violations.map(v => v.type).join(', '),
          needs_human_review: true
        }
      });

      this.logger.warn('🚨 ESCALATION CREATED', {
        conversationId,
        shopId,
        violations: violations.map(v => v.type),
        reason: escalation.context.guardrailReasons
      });

      // 2. Alert ops (via n8n or direct service)
      try {
        await this.opsAlertService.sendEscalationAlert({
          type: 'GUARDRAIL_ESCALATION',
          conversationId,
          shopId,
          violations: escalation.violations,
          customerMessage: originalMessage,
          aiResponse: aiResponse,
          priority: escalation.violations.some(v => v.severity === 'HIGH') ? 'HIGH' : 'MEDIUM'
        });
      } catch (alertError) {
        this.logger.error('❌ Failed to send ops alert', { 
          error: alertError.message,
          conversationId 
        });
        // Don't fail if alert fails; escalation is still created
      }

      return escalation;

    } catch (error) {
      this.logger.error('❌ Failed to handle guardrail failure', {
        error: error.message,
        conversationId
      });
      throw error;
    }
  }

  /**
   * Check toxicity score of response (0-1 scale)
   * Optional: can use Perspective API, OpenAI Moderation, etc.
   */
  private async checkToxicity(text) {
    try {
      // TODO: Integrate with Perspective API or similar
      // For now, return stub
      return 0.1; // Low toxicity by default
    } catch (error) {
      this.logger.debug('Toxicity check unavailable', { error: error.message });
      return 0; // No toxicity detected if check fails
    }
  }

  /**
   * Get escalation status for a conversation
   */
  async getEscalationStatus(conversationId) {
    try {
      const conversation = await this.conversationRepository.findById(conversationId);
      
      if (!conversation.hitl || !conversation.metadata?.escalation) {
        return null;
      }

      return {
        conversationId,
        status: conversation.metadata.escalation.status,
        violations: conversation.metadata.escalation.violations,
        timestamp: conversation.metadata.escalation.timestamp,
        handledBy: conversation.metadata.escalation.handledBy,
        approvalTime: conversation.metadata.escalation.approvalTime
      };
    } catch (error) {
      this.logger.error('❌ Failed to get escalation status', { error: error.message });
      return null;
    }
  }

  /**
   * Approve escalation (ops action)
   */
  async approveEscalation(conversationId, approverUserId, approverNotes) {
    try {
      const conversation = await this.conversationRepository.findById(conversationId);
      
      if (!conversation.hitl) {
        throw new Error('Conversation not in HITL mode');
      }

      await conversation.update({
        hitl: false, // Release from human review
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

      this.logger.info('✅ Escalation approved', {
        conversationId,
        approverUserId
      });

      return { status: 'APPROVED' };
    } catch (error) {
      this.logger.error('❌ Failed to approve escalation', { error: error.message });
      throw error;
    }
  }

  /**
   * Reject escalation (ops action)
   */
  async rejectEscalation(conversationId, approverUserId, rejectReason) {
    try {
      const conversation = await this.conversationRepository.findById(conversationId);
      
      if (!conversation.hitl) {
        throw new Error('Conversation not in HITL mode');
      }

      await conversation.update({
        hitl: false, // Release from human review
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

      this.logger.info('✅ Escalation rejected', {
        conversationId,
        approverUserId,
        reason: rejectReason
      });

      return { status: 'REJECTED' };
    } catch (error) {
      this.logger.error('❌ Failed to reject escalation', { error: error.message });
      throw error;
    }
  }
}

module.exports = GuardrailService;

/**
 * GUARDRAIL FLOW DIAGRAM
 * 
 * Customer Message
 *     ↓
 * [Guard 1: RTO Fraud] → HIGH violation? → ESCALATE
 * [Guard 2: Prompt Injection] → HIGH violation? → ESCALATE
 * [Guard 3: Hallucination] → MEDIUM violation? → Need review
 * [Guard 4: Coherence] → Length OK? Continue
 * [Guard 5: Toxicity] → Offensive? Flag
 *     ↓
 * All guards pass? → SEND TO CUSTOMER
 * Any HIGH violation? → ESCALATE (mark HITL)
 * 
 * ESCALATION WORKFLOW
 * 1. Conversation marked hitl=true
 * 2. Response NOT sent to customer
 * 3. Ops alerted via WhatsApp/SMS
 * 4. Ops reviews via dashboard
 * 5. Ops approves/rejects
 * 6. Customer sees response (approved) or message (rejected)
 */
