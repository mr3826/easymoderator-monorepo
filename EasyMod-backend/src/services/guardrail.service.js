/**
 * Guardrail Service - Task 4
 * Security guardrails for LLM output validation
 * Checks: RTO fraud, prompt injection, hallucination, coherence, toxicity
 * 
 * @module services/guardrail.service
 */

const logger = require('../utils/structured-logger');
const { AppError } = require('../utils/app-error');
const crypto = require('crypto');

class GuardrailService {
  constructor(config = {}) {
    this.config = config;
    this.violationThresholds = {
      promptInjection: 0.7,
      hallucination: 0.6,
      toxicity: 0.5,
      coherence: 0.4
    };
  }

  /**
   * Run all guardrails on LLM output
   * @async
   * @param {string} userMessage - Original user message
   * @param {string} llmResponse - LLM generated response
   * @param {Object} context - Additional context
   * @returns {Promise<Object>} Guardrail validation result
   */
  async validateOutput(userMessage, llmResponse, context = {}) {
    const loggingId = crypto.randomUUID();
    const startTime = Date.now();

    const auditLog = {
      loggingId,
      userMessageLen: userMessage?.length,
      responseLen: llmResponse?.length,
      checks: {},
      timestamp: new Date().toISOString(),
      shopId: context.shopId,
      userId: context.userId,
      conversationId: context.conversationId
    };

    logger.info('Running guardrail checks', {
      loggingId,
      shopId: context.shopId,
      responseLen: llmResponse?.length
    });

    try {
      const checks = await Promise.all([
        this._checkRTOFraud(userMessage, llmResponse, loggingId),
        this._checkPromptInjection(userMessage, llmResponse, loggingId),
        this._checkHallucination(userMessage, llmResponse, loggingId),
        this._checkCoherence(llmResponse, loggingId),
        this._checkToxicity(llmResponse, loggingId)
      ]);

      const results = {
        rtoFraud: checks[0],
        promptInjection: checks[1],
        hallucination: checks[2],
        coherence: checks[3],
        toxicity: checks[4]
      };

      auditLog.checks = results;

      // Aggregate violations
      const violations = [];
      const passed = {};

      Object.entries(results).forEach(([checkName, checkResult]) => {
        passed[checkName] = checkResult.passed;

        if (!checkResult.passed) {
          violations.push({
            type: checkName,
            confidence: checkResult.confidence,
            reason: checkResult.reason,
            recommendations: checkResult.recommendations
          });
        }

        auditLog.checks[checkName] = {
          passed: checkResult.passed,
          confidence: checkResult.confidence,
          score: checkResult.score
        };
      });

      const allPassed = !violations.some(v => !passed[v.type]);

      const elapsed = Date.now() - startTime;

      // Log result
      await this._logAudit(auditLog);

      logger.info('Guardrail validation completed', {
        loggingId,
        passed: allPassed,
        violationCount: violations.length,
        elapsed
      });

      return {
        passed: allPassed,
        loggingId,
        violations,
        checks: results,
        elapsed,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Guardrail check failed', {
        loggingId,
        error: error.message
      });

      throw new AppError(
        'GUARDRAIL_CHECK_FAILED',
        'Security validation error',
        500
      );
    }
  }

  /**
   * Check 1: RTO Fraud Detection
   * Detects if response attempts to bypass authorization/authentication
   * @private
   * @async
   */
  async _checkRTOFraud(userMessage, llmResponse, loggingId) {
    const rtoPatterns = [
      /(?:skip|bypass|ignore)\s+(?:auth|check|verif|guard)/gi,
      /(?:secret|api[\s_-]?key|token|credential).*(?:is|=|:|here)/gi,
      /(?:as\s+(?:admin|root|superuser))/gi,
      /(?:execute|run|eval)\s+(?:this|code|command)/gi,
      /(?:do\s+not|don't|stop)\s+(?:validate|check|verify)|disable\s+(?:validation|security)/gi
    ];

    let matchCount = 0;
    let maxConfidence = 0;

    for (const pattern of rtoPatterns) {
      const matches = llmResponse.match(pattern);
      if (matches) {
        matchCount += matches.length;
        maxConfidence = Math.min(1, matchCount * 0.15);
      }
    }

    const passed = maxConfidence < this.violationThresholds.promptInjection;

    logger.debug('RTO Fraud check completed', {
      loggingId,
      confidence: maxConfidence,
      passed,
      matchCount
    });

    return {
      passed,
      confidence: parseFloat(maxConfidence.toFixed(3)),
      score: parseFloat((1 - maxConfidence).toFixed(3)),
      reason: passed 
        ? 'No RTO fraud patterns detected'
        : `Detected ${matchCount} potential RTO fraud patterns`,
      recommendations: passed 
        ? []
        : ['Review response for authorization bypass attempts', 'Log incident for audit']
    };
  }

  /**
   * Check 2: Prompt Injection Detection
   * Detects if response contains prompt injection attempts
   * @private
   * @async
   */
  async _checkPromptInjection(userMessage, llmResponse, loggingId) {
    const injectionPatterns = [
      /SYSTEM.*?:/gi,
      /INSTRUCTIONS?.*?:/gi,
      /IGNORE.*(?:INSTRUCTION|SYSTEM|RULE)/gi,
      /(?:forget|disregard).*(?:previous|above|prior).*instruction/gi,
      /(?:\[.*(?:JAILBREAK|UNLOCK|OVERRIDE|BREAK)\s*:\s*.*\])/gi,
      /BEGIN\s+ALTERNATE\s+INSTRUCTIONS/gi
    ];

    let totalMatches = 0;

    for (const pattern of injectionPatterns) {
      const matches = llmResponse.match(pattern);
      if (matches) {
        totalMatches += matches.length;
      }
    }

    const confidence = Math.min(1, totalMatches * 0.2);
    const passed = confidence < this.violationThresholds.promptInjection;

    // Check if response echoes user input (possible mirror attack)
    const userWords = userMessage.toLowerCase().split(/\s+/).slice(0, 5);
    const responseWords = llmResponse.toLowerCase().split(/\s+/);
    const echoMatches = userWords.filter(w => responseWords.includes(w)).length;
    const echoConfidence = echoMatches > 3 ? 0.3 : 0;

    const finalConfidence = Math.max(confidence, echoConfidence);

    logger.debug('Prompt injection check completed', {
      loggingId,
      confidence: finalConfidence,
      passed,
      patternMatches: totalMatches,
      echoMatches
    });

    return {
      passed: finalConfidence < this.violationThresholds.promptInjection,
      confidence: parseFloat(finalConfidence.toFixed(3)),
      score: parseFloat((1 - finalConfidence).toFixed(3)),
      reason: passed
        ? 'No prompt injection patterns detected'
        : `Detected ${totalMatches} potential injection patterns`,
      recommendations: passed
        ? []
        : ['Sanitize output before displaying', 'Consider rephrasing through different model']
    };
  }

  /**
   * Check 3: Hallucination Detection
   * Detects if response contains false, made-up, or inconsistent information
   * @private
   * @async
   */
  async _checkHallucination(userMessage, llmResponse, loggingId) {
    // Detection heuristics for hallucinations
    let hallucScore = 0;

    // Check 1: Specific false claims patterns
    const falseClaims = [
      /(?:I\s+(?:can|am|have)\s+(?:definitely|certainly|absolutely)\s+.{1,50}(?:fact|fact that|guarantee|promise|ensure))/gi,
      /(?:(?:my|our)\s+(?:database|records|system)\s+(?:show|indicate|prove)\s+.{1,50}false)/gi,
      /(?:(?:100|1000|million|billion)%\s+(?:sure|certain|guaranteed))/gi
    ];

    let claimMatches = 0;
    for (const pattern of falseClaims) {
      const matches = llmResponse.match(pattern) || [];
      claimMatches += matches.length;
    }
    hallucScore += claimMatches * 0.15;

    // Check 2: Excessive hedging (opposite of hallucination but suspicious)
    const hedgeWords = (llmResponse.match(/\b(?:might|may|could|perhaps|possibly|seems|appears|allegedly)\b/gi) || []).length;
    const confidenceWords = (llmResponse.match(/\b(?:definitely|certainly|absolutely|definitely|clearly|obviously)\b/gi) || []).length;

    // High confidence + low hedging = potential hallucination
    if (confidenceWords > hedgeWords + 2) {
      hallucScore += 0.2;
    }

    // Check 3: Circular reasoning or self-reference loops
    const lines = llmResponse.split(/[.!?]+/);
    if (lines.length > 2) {
      const firstConcept = lines[0];
      const lastConcept = lines[lines.length - 1];
      if (firstConcept.length > 20 && lastConcept.includes(firstConcept.substring(0, 10))) {
        hallucScore += 0.1;
      }
    }

    hallucScore = Math.min(1, hallucScore);
    const passed = hallucScore < this.violationThresholds.hallucination;

    logger.debug('Hallucination check completed', {
      loggingId,
      confidence: hallucScore,
      passed,
      claimMatches,
      confidenceWords,
      hedgeWords
    });

    return {
      passed,
      confidence: parseFloat(hallucScore.toFixed(3)),
      score: parseFloat((1 - hallucScore).toFixed(3)),
      reason: passed
        ? 'Response appears factually grounded'
        : 'Response contains potential hallucinations or false claims',
      recommendations: passed
        ? []
        : ['Verify claims with external sources', 'Request citations or evidence', 'Use more grounded model']
    };
  }

  /**
   * Check 4: Coherence & Consistency
   * Detects incoherent, rambling, or logically inconsistent responses
   * @private
   * @async
   */
  async _checkCoherence(llmResponse, loggingId) {
    let incoherenceScore = 0;

    // Check 1: Response length appropriateness
    if (llmResponse.length < 20) {
      incoherenceScore += 0.3; // Too short
    } else if (llmResponse.length > 5000) {
      incoherenceScore += 0.1; // Potentially rambling
    }

    // Check 2: Sentence structure quality
    const sentences = llmResponse.match(/[^.!?]+[.!?]+/g) || [];
    const avgSentenceLength = sentences.length > 0
      ? llmResponse.length / sentences.length
      : llmResponse.length;

    if (avgSentenceLength > 200 || avgSentenceLength < 10) {
      incoherenceScore += 0.15; // Abnormal sentence lengths
    }

    // Check 3: Topic drift detection (word diversity)
    const words = llmResponse
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3);

    const uniqueWords = new Set(words);
    const diversity = words.length > 0 ? uniqueWords.size / words.length : 0;

    if (diversity < 0.3) {
      incoherenceScore += 0.1; // Too repetitive
    }
    if (diversity > 0.9 && words.length > 100) {
      incoherenceScore += 0.05; // Very scattered
    }

    // Check 4: Paragraph structure
    const paragraphs = llmResponse.split(/\n\n+/);
    if (paragraphs.length === 1 && llmResponse.length > 500) {
      incoherenceScore += 0.1; // Long text with no paragraph breaks
    }

    incoherenceScore = Math.min(1, incoherenceScore);
    const passed = incoherenceScore < this.violationThresholds.coherence;

    logger.debug('Coherence check completed', {
      loggingId,
      confidence: incoherenceScore,
      passed,
      sentenceCount: sentences.length,
      wordDiversity: parseFloat(diversity.toFixed(2)),
      avgSentenceLength: parseFloat(avgSentenceLength.toFixed(1))
    });

    return {
      passed,
      confidence: parseFloat(incoherenceScore.toFixed(3)),
      score: parseFloat((1 - incoherenceScore).toFixed(3)),
      reason: passed
        ? 'Response is coherent and well-structured'
        : 'Response shows signs of incoherence or inconsistency',
      recommendations: passed
        ? []
        : ['Consider requesting clarification', 'Try with different input framing']
    };
  }

  /**
   * Check 5: Toxicity Detection
   * Detects hateful, abusive, or harmful content
   * @private
   * @async
   */
  async _checkToxicity(llmResponse, loggingId) {
    let toxicityScore = 0;

    // Toxicity patterns (basic - production should use ML model)
    const toxicPatterns = [
      { pattern: /(?:hate|damn|hell|curse|f\*\*\*|sh\*\*)/gi, weight: 0.3 },
      { pattern: /(?:stupid|idiot|moron|dumb|crazy)/gi, weight: 0.4 },
      { pattern: /(?:kill|hurt|punch|slap|beat)\s+(?:you|them|it|him|her)/gi, weight: 0.6 },
      { pattern: /(?:racist|sexist|homophobic)\s+(?:joke|comment|remark)/gi, weight: 0.7 },
      { pattern: /(?:you\s+(?:suck|blow)|go\s+(?:to|fuck))/gi, weight: 0.5 }
    ];

    for (const { pattern, weight } of toxicPatterns) {
      const matches = llmResponse.match(pattern) || [];
      toxicityScore += matches.length * weight * 0.05;
    }

    toxicityScore = Math.min(1, toxicityScore);
    const passed = toxicityScore < this.violationThresholds.toxicity;

    logger.debug('Toxicity check completed', {
      loggingId,
      confidence: toxicityScore,
      passed
    });

    return {
      passed,
      confidence: parseFloat(toxicityScore.toFixed(3)),
      score: parseFloat((1 - toxicityScore).toFixed(3)),
      reason: passed
        ? 'Response contains no toxic content'
        : 'Response contains potentially toxic or harmful language',
      recommendations: passed
        ? []
        : ['Filter output for harmful content', 'Report to moderation team', 'Retrain model']
    };
  }

  /**
   * Audit log for guardrail checks
   * @private
   * @async
   */
  async _logAudit(auditLog) {
    // In production, store to database or external audit service
    logger.info('Guardrail audit logged', {
      loggingId: auditLog.loggingId,
      shopId: auditLog.shopId,
      checks: auditLog.checks
    });

    // Optionally send to external audit service
    // await externalAuditService.log(auditLog);
  }

  /**
   * Get guardrail statistics
   * @returns {Object} Current configuration and thresholds
   */
  getConfig() {
    return {
      thresholds: this.violationThresholds,
      checks: [
        'rtoFraud',
        'promptInjection',
        'hallucination',
        'coherence',
        'toxicity'
      ]
    };
  }

  /**
   * Update violation thresholds (for tuning)
   * @param {Object} newThresholds - New threshold values
   */
  updateThresholds(newThresholds) {
    Object.assign(this.violationThresholds, newThresholds);
    logger.info('Guardrail thresholds updated', {
      thresholds: this.violationThresholds
    });
  }
}

module.exports = GuardrailService;
