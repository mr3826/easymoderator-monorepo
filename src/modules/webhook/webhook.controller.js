const crypto = require('crypto');
const config = require('src/config/config');
const { AppError } = require('src/utils/AppError');
const { postToWorkflow } = require('src/utils/workflow-client');

const validateWebhook = async (req, res, next) => {
    try {
        const { channel, payload } = req.body;
        if (!channel || !payload) {
            throw new AppError('channel and payload are required', 400);
        }

        res.status(200).json({ valid: true });
    } catch (error) {
        next(error);
    }
};

const sendWebhookMessage = async (req, res, next) => {
    try {
        const response = await postToWorkflow(config.workflowUrl, {
            type: 'send',
            ...req.body
        });

        res.status(200).json({
            message_id: response?.message_id || null,
            status: response?.status || 'sent',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        next(error);
    }
};

const retryWebhookMessage = async (req, res, next) => {
    try {
        const response = await postToWorkflow(config.workflowUrl, {
            type: 'retry',
            ...req.body
        });

        res.status(200).json({
            success: true,
            message_id: response?.message_id || null
        });
    } catch (error) {
        next(error);
    }
};

const registerWebhook = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        res.status(201).json({
            webhook_id: `wh_${Date.now()}`,
            is_active: true
        });
    } catch (error) {
        next(error);
    }
};

const getWebhooks = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        res.status(200).json({
            webhooks: [],
            total: 0
        });
    } catch (error) {
        next(error);
    }
};

const updateWebhook = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { webhookId } = req.params;
        res.status(200).json({
            webhook_id: webhookId,
            updated: true
        });
    } catch (error) {
        next(error);
    }
};

const deleteWebhook = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { webhookId } = req.params;
        res.status(200).json({
            webhook_id: webhookId,
            deleted: true
        });
    } catch (error) {
        next(error);
    }
};

const testWebhook = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { webhookId } = req.params;
        res.status(200).json({
            webhook_id: webhookId,
            test_sent: true,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        next(error);
    }
};

const getWebhookLogs = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { webhookId } = req.params;
        res.status(200).json({
            webhook_id: webhookId,
            logs: [],
            total: 0
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    validateWebhook,
    sendWebhookMessage,
    retryWebhookMessage,
    registerWebhook,
    getWebhooks,
    updateWebhook,
    deleteWebhook,
    testWebhook,
    getWebhookLogs
};
