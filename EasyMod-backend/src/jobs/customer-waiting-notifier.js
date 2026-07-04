const BaseJob = require('./base-job');
const { Conversation, Message } = require('../modules/entities');
const { Op } = require('sequelize');
const merchantNotificationService = require('../modules/notification/merchant-notification.service');
const { NOTIFICATION_EVENTS } = require('../modules/notification/notification-events');

const MINUTE_MS = 60 * 1000;
const DEFAULT_WAIT_MINUTES = 30;
const LOOKBACK_HOURS = 24;
const DEDUPE_TTL_SECONDS = 6 * 60 * 60;

class CustomerWaitingNotifier extends BaseJob {
    constructor() {
        super('customer_waiting_notifier');
    }

    generateExecutionId(runDate) {
        const bucketMs = 15 * MINUTE_MS;
        const bucket = Math.floor(runDate.getTime() / bucketMs) * bucketMs;
        return `${this.jobName}-${new Date(bucket).toISOString()}`;
    }

    async run({ dryRun, runDate }) {
        const waitMinutes = Number(process.env.CUSTOMER_WAITING_ALERT_MINUTES || DEFAULT_WAIT_MINUTES);
        const cutoff = new Date(runDate.getTime() - waitMinutes * MINUTE_MS);
        const lookback = new Date(runDate.getTime() - LOOKBACK_HOURS * 60 * MINUTE_MS);
        const maxCandidates = Number(process.env.CUSTOMER_WAITING_ALERT_SCAN_LIMIT || 200);

        const customerMessages = await Message.findAll({
            where: {
                sender: 'customer',
                created_at: { [Op.gte]: lookback, [Op.lte]: cutoff }
            },
            include: [{
                model: Conversation,
                as: 'conversation',
                required: true,
                where: {
                    hitl: true,
                    status: { [Op.notIn]: ['resolved', 'closed'] }
                },
                attributes: ['id', 'shop_id', 'title', 'status', 'hitl']
            }],
            order: [['created_at', 'DESC']],
            limit: maxCandidates
        });

        this.metrics.recordsProcessed = customerMessages.length;
        const seenConversations = new Set();
        const results = {
            candidatesScanned: customerMessages.length,
            alertsQueued: 0,
            waitMinutes,
            dryRun
        };

        for (const message of customerMessages) {
            const conversation = message.conversation;
            if (!conversation || seenConversations.has(conversation.id)) continue;
            seenConversations.add(conversation.id);

            try {
                const latestMessage = await Message.findOne({
                    where: { conversation_id: conversation.id },
                    order: [['created_at', 'DESC']]
                });

                if (!latestMessage || latestMessage.id !== message.id || latestMessage.sender !== 'customer') {
                    continue;
                }

                const actualWaitMinutes = Math.max(1, Math.round((runDate - new Date(message.created_at)) / MINUTE_MS));
                if (!dryRun) {
                    await merchantNotificationService.notifyShop(
                        conversation.shop_id,
                        NOTIFICATION_EVENTS.CUSTOMER_WAITING_TOO_LONG,
                        {
                            conversationId: conversation.id,
                            customerName: conversation.title || null,
                            waitMinutes: actualWaitMinutes,
                            lastMessage: String(message.content || '').slice(0, 180)
                        },
                        {
                            dedupeKey: `${conversation.id}:${runDate.toISOString().slice(0, 13)}`,
                            dedupeTtlSeconds: DEDUPE_TTL_SECONDS
                        }
                    );
                    results.alertsQueued++;
                }

                this.metrics.recordsSucceeded++;
            } catch (error) {
                this.metrics.recordsFailed++;
                this.metrics.errors.push(`Conversation ${conversation.id}: ${error.message}`);
                this.logger.warn('Failed to queue customer waiting alert', {
                    conversationId: conversation.id,
                    shopId: conversation.shop_id,
                    error: error.message
                });
            }
        }

        return results;
    }
}

module.exports = CustomerWaitingNotifier;
