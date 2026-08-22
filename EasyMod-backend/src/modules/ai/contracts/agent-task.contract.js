'use strict';

const CONTRACT_VERSION = '1.0';

const DOMAINS = Object.freeze([
    'PRODUCT',
    'ORDER',
    'KNOWLEDGE',
    'COMMERCE_OPS',
    'SUPPORT',
]);

/**
 * @typedef {object} TenantContext
 * @property {string} shopId
 * @property {string} channelId
 * @property {'META_MESSENGER'} platform
 * @property {string} customerId
 * @property {string} conversationId
 */

/**
 * @typedef {object} AgentTask
 * @property {string} contractVersion
 * @property {string} taskId
 * @property {TenantContext} tenant
 * @property {string} actorAgent
 * @property {string} domain
 * @property {object} input
 * @property {object} context
 * @property {object[]} evidence
 * @property {number} remainingTurnModelCalls
 * @property {number} remainingConversationModelCalls
 * @property {number} domainHops
 * @property {string} traceId
 * @property {string} createdAt
 * @property {string} expiresAt
 */

const requiredText = (value, field) => {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new TypeError(`${field} is required`);
    }
    return value;
};

/**
 * Validate the minimum envelope before an agent can receive a task.
 * @param {AgentTask} task
 * @returns {true}
 */
const validateAgentTask = (task) => {
    if (!task || task.contractVersion !== CONTRACT_VERSION) {
        throw new TypeError(`Unsupported agent task contract: ${task?.contractVersion || 'missing'}`);
    }
    requiredText(task.taskId, 'taskId');
    requiredText(task.actorAgent, 'actorAgent');
    requiredText(task.traceId, 'traceId');
    if (!DOMAINS.includes(task.domain)) throw new TypeError(`Unsupported domain: ${task.domain}`);
    for (const field of ['shopId', 'conversationId', 'customerId']) {
        requiredText(task.tenant?.[field], `tenant.${field}`);
    }
    if (!Array.isArray(task.evidence)) throw new TypeError('evidence must be an array');
    if (!Number.isInteger(task.remainingTurnModelCalls) || task.remainingTurnModelCalls < 0) {
        throw new TypeError('remainingTurnModelCalls must be a non-negative integer');
    }
    if (!Number.isInteger(task.remainingConversationModelCalls) || task.remainingConversationModelCalls < 0) {
        throw new TypeError('remainingConversationModelCalls must be a non-negative integer');
    }
    if (!Number.isInteger(task.domainHops) || task.domainHops < 0) {
        throw new TypeError('domainHops must be a non-negative integer');
    }
    return true;
};

/**
 * Construct a versioned task envelope. Validation is intentionally strict so a
 * missing tenant or budget field cannot become an implicit permission.
 * @param {object} input
 * @returns {AgentTask}
 */
const createAgentTask = (input = {}) => {
    const task = {
        contractVersion: CONTRACT_VERSION,
        taskId: input.taskId,
        tenant: input.tenant,
        actorAgent: input.actorAgent,
        domain: input.domain,
        input: input.input || {},
        context: input.context || {},
        evidence: input.evidence || [],
        remainingTurnModelCalls: input.remainingTurnModelCalls,
        remainingConversationModelCalls: input.remainingConversationModelCalls,
        domainHops: input.domainHops,
        traceId: input.traceId,
        createdAt: input.createdAt || new Date().toISOString(),
        expiresAt: input.expiresAt,
    };
    validateAgentTask(task);
    return task;
};

module.exports = {
    CONTRACT_VERSION,
    DOMAINS,
    createAgentTask,
    validateAgentTask,
};
