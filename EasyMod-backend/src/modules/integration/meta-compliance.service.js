'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { Op } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');
const {
    AuditLog,
    Conversation,
    Customer,
    CustomerDeliveryStats,
    CustomerPreference,
    DeliveryTracking,
    Message,
    MetaDataDeletionRequest,
    MetaUserIdentity,
    Order,
    OrderInvoice,
    OrderReturn,
    OwnerNotification,
    PaymentTransaction,
    SupportTicket,
    TrxIDLog,
} = require('../entities');
const OrderSession = require('../order/order-session.entity');
const consentService = require('../consent/consent.service');
const { createLogger } = require('../../utils/structured-logger');
const { opsAlert } = require('../../utils/ops-alert');

const logger = createLogger('MetaComplianceService');
const UPLOAD_ROOT = path.resolve(__dirname, '../../../uploads');
const OWNED_ATTACHMENT_PREFIXES = [
    '/uploads/conversation-attachments/',
    '/uploads/invoices/',
];
const PROCESSING_STALE_MS = 15 * 60 * 1000;

function sha256(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function hmacSha256(secret, value, encoding = 'hex') {
    return crypto.createHmac('sha256', secret).update(String(value)).digest(encoding);
}

function requestFingerprint(signedRequest) {
    return sha256(signedRequest);
}

function identityHash(appSecret, appScopedUserId) {
    return hmacSha256(appSecret, `meta-user:${appScopedUserId}`);
}

function confirmationCode(appSecret, fingerprint) {
    const opaque = hmacSha256(appSecret, `meta-deletion-status:${fingerprint}`, 'base64url').slice(0, 32);
    return `DEL-${opaque}`;
}

function confirmationCodeHash(code) {
    return sha256(code);
}

function serializeDeletionStatus(row) {
    return {
        status: String(row.status || '').toLowerCase(),
        matched_customers: row.matched_customer_count || 0,
        conversations_deleted: row.conversations_deleted_count || 0,
        messages_deleted: row.messages_deleted_count || 0,
        orders_anonymized: row.orders_anonymized_count || 0,
        attachments_deleted: row.attachments_deleted_count || 0,
        completed_at: row.completed_at || null,
        retryable: ['FAILED', 'IDENTITY_NOT_RESOLVED'].includes(row.status),
        failure_code: row.failure_code || null,
    };
}

async function writeAudit(action, requestId, {
    shopId = null,
    metadata = null,
    transaction = null,
} = {}) {
    await AuditLog.create({
        user_id: null,
        shop_id: shopId,
        action,
        resource_type: 'meta_data_deletion_request',
        resource_id: requestId,
        metadata,
        idempotency_key: `${requestId}:${action}:${shopId || 'global'}`,
    }, { transaction });
}

function ownedAttachmentPath(value) {
    if (typeof value !== 'string') return null;
    let pathname;
    try {
        pathname = value.startsWith('/')
            ? new URL(value, 'https://local.invalid').pathname
            : new URL(value).pathname;
    } catch (_) {
        return null;
    }
    if (!OWNED_ATTACHMENT_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null;

    let decoded;
    try {
        decoded = decodeURIComponent(pathname.slice('/uploads/'.length));
    } catch (_) {
        return null;
    }
    const normalized = decoded.replace(/\\/g, '/');
    const allowedDirectory = normalized.startsWith('conversation-attachments/')
        || normalized.startsWith('invoices/');
    if (!allowedDirectory || normalized.split('/').includes('..')) {
        return null;
    }
    return normalized;
}

function collectOwnedInvoicePaths(invoices) {
    const paths = new Set();
    for (const invoice of invoices || []) {
        const relativePath = ownedAttachmentPath(invoice?.pdf_url || invoice?.get?.('pdf_url'));
        if (relativePath) paths.add(relativePath);
    }
    return [...paths];
}

function retainedOrderSnapshot(value) {
    const snapshot = value && typeof value === 'object' ? value : {};
    const allowed = [
        'order_number',
        'items',
        'subtotal',
        'discount',
        'tax',
        'delivery_fee',
        'total',
        'payment_method',
        'payment_status',
    ];
    return allowed.reduce((result, key) => {
        if (Object.prototype.hasOwnProperty.call(snapshot, key)) result[key] = snapshot[key];
        return result;
    }, { customerDeleted: true });
}

function retainedTrackingHistory(value) {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => ({
        status: entry?.status || null,
        timestamp: entry?.timestamp || null,
    }));
}

function claimLostError() {
    return Object.assign(new Error('Deletion processing claim was superseded'), {
        code: 'DELETION_CLAIM_LOST',
    });
}

async function fencedRequestUpdate(request, processingToken, values, {
    transaction = null,
} = {}) {
    const [updated] = await MetaDataDeletionRequest.update(values, {
        where: {
            id: request.id,
            status: 'PROCESSING',
            processing_token: processingToken,
        },
        transaction,
    });
    if (updated !== 1) throw claimLostError();
    Object.assign(request, values);
}

function collectOwnedAttachmentPaths(messages) {
    const paths = new Set();
    for (const message of messages) {
        const metadata = message?.metadata || message?.get?.('metadata') || {};
        const candidates = [
            metadata.image_url,
            metadata.file_url,
            metadata.url,
            ...(Array.isArray(metadata.attachments)
                ? metadata.attachments.flatMap((item) => [item?.url, item?.file_url, item?.image_url])
                : []),
        ];
        for (const candidate of candidates) {
            const relativePath = ownedAttachmentPath(candidate);
            if (relativePath) paths.add(relativePath);
        }
    }
    return [...paths];
}

async function cleanupOwnedAttachments(relativePaths) {
    let deleted = 0;
    const remaining = [];
    for (const relativePath of relativePaths || []) {
        const absolutePath = path.resolve(UPLOAD_ROOT, relativePath);
        if (!absolutePath.startsWith(`${UPLOAD_ROOT}${path.sep}`)) {
            remaining.push(relativePath);
            continue;
        }
        try {
            await fs.unlink(absolutePath);
            deleted += 1;
        } catch (err) {
            if (err.code === 'ENOENT') {
                // Already gone is a successful idempotent outcome.
                deleted += 1;
            } else {
                remaining.push(relativePath);
            }
        }
    }
    return { deleted, remaining };
}

async function scrubOwnerNotifications(shopId, orderIds, transaction) {
    if (!orderIds.length) return;
    const notifications = await OwnerNotification.findAll({
        where: { shop_id: shopId },
        transaction,
        lock: transaction.LOCK.UPDATE,
    });
    for (const notification of notifications) {
        const data = notification.customer_data || {};
        if (!orderIds.some((id) => String(id) === String(data.orderId))) continue;
        await notification.update({
            customer_message: null,
            customer_data: {
                orderId: data.orderId || null,
                orderNumber: data.orderNumber || null,
                amount: data.amount || null,
                paymentMethod: data.paymentMethod || null,
                transactionId: data.transactionId || null,
                customerDeleted: true,
            },
            owner_info: null,
        }, { transaction });
    }
}

async function scrubOrderInvoices(shopId, orderIds, transaction) {
    if (!orderIds.length) return [];
    const invoices = await OrderInvoice.findAll({
        where: {
            shop_id: shopId,
            order_id: { [Op.in]: orderIds },
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
    });
    for (const invoice of invoices) {
        await invoice.update({
            pdf_url: null,
            customer_info: null,
            delivery_info: null,
            order_data: retainedOrderSnapshot(invoice.order_data),
        }, { transaction });
    }
    return collectOwnedInvoicePaths(invoices);
}

async function scrubDeliveryTracking(orderIds, transaction) {
    if (!orderIds.length) return;
    const rows = await DeliveryTracking.findAll({
        where: { order_id: { [Op.in]: orderIds } },
        transaction,
        lock: transaction.LOCK.UPDATE,
    });
    for (const row of rows) {
        await row.update({
            tracking_number: `deleted-${row.id}`,
            status_history: retainedTrackingHistory(row.status_history),
            location_info: null,
            delivery_agent_info: null,
        }, { transaction });
    }
}

async function scrubAuditRecords(shopId, customerId, orderIds, transaction) {
    const resourceIds = [customerId, ...orderIds].map(String);
    const rows = await AuditLog.findAll({
        where: {
            shop_id: shopId,
            resource_id: { [Op.in]: resourceIds },
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
    });
    for (const row of rows) {
        await row.update({
            old_values: null,
            new_values: null,
            metadata: { subjectDeleted: true },
        }, { transaction });
    }
}

async function deleteCustomerData(customer, mapping, request, transaction) {
    const shopId = customer.shop_id;
    const customerId = customer.id;
    const conversations = await Conversation.findAll({
        where: {
            shop_id: shopId,
            customer_id: customerId,
        },
        attributes: ['id'],
        transaction,
        lock: transaction.LOCK.UPDATE,
    });
    const conversationIds = conversations.map((row) => row.id);
    const messages = conversationIds.length
        ? await Message.findAll({
            where: { conversation_id: { [Op.in]: conversationIds } },
            attributes: ['id', 'metadata'],
            transaction,
        })
        : [];
    const attachmentPaths = collectOwnedAttachmentPaths(messages);

    await consentService.recordDataDeletion({
        shopId,
        channelId: mapping.channel_id,
        customerId,
        platform: 'facebook',
        metadata: { request_id: request.id },
        transaction,
        strictAudit: true,
    });

    const orders = await Order.findAll({
        where: { shop_id: shopId, customer_id: customerId },
        attributes: ['id'],
        transaction,
        lock: transaction.LOCK.UPDATE,
    });
    const orderIds = orders.map((row) => row.id);

    await OrderSession.destroy({
        where: {
            shop_id: shopId,
            [Op.or]: [
                { customer_id: customerId },
                { customer_channel_id: mapping.page_scoped_user_id },
            ],
        },
        transaction,
    });
    await OrderReturn.destroy({
        where: { customer_id: customerId },
        transaction,
    });
    await SupportTicket.destroy({
        where: { shop_id: shopId, customer_id: customerId },
        transaction,
    });

    if (orderIds.length) {
        attachmentPaths.push(...await scrubOrderInvoices(shopId, orderIds, transaction));
        await TrxIDLog.update({
            sender_phone: null,
            ocr_raw: null,
        }, {
            where: {
                shop_id: shopId,
                order_id: { [Op.in]: orderIds },
            },
            transaction,
        });
        await PaymentTransaction.update({
            gateway_response: null,
        }, {
            where: {
                shop_id: shopId,
                order_id: { [Op.in]: orderIds },
            },
            transaction,
        });
        await scrubDeliveryTracking(orderIds, transaction);
        await Order.update({
            customer_id: null,
            customer_name: 'Deleted customer',
            customer_phone: null,
            delivery_location: null,
            delivery_address: null,
            delivery_area: null,
            delivery_zone: null,
            delivery_consignment_id: null,
            delivery_tracking_code: null,
            note: null,
            notes: null,
            idempotency_key: null,
        }, {
            where: { shop_id: shopId, customer_id: customerId },
            transaction,
        });
        // These Phase 0 columns remain in the production PostgreSQL table but
        // are intentionally absent from the current Order entity.
        await sequelize.query(`
            UPDATE orders
            SET courier_data = NULL,
                tracking_id = NULL,
                metadata = NULL
            WHERE shop_id = :shopId
              AND id IN (:orderIds)
        `, {
            replacements: { shopId, orderIds },
            transaction,
        });
        await scrubOwnerNotifications(shopId, orderIds, transaction);
    }
    await scrubAuditRecords(shopId, customerId, orderIds, transaction);

    if (customer.phone) {
        await CustomerDeliveryStats.destroy({
            where: { shop_id: shopId, phone: customer.phone },
            transaction,
        });
    }
    await CustomerPreference.destroy({
        where: { shop_id: shopId, customer_id: customerId },
        transaction,
    });
    if (conversationIds.length) {
        await Conversation.destroy({
            where: {
                id: { [Op.in]: conversationIds },
                shop_id: shopId,
                customer_id: customerId,
            },
            transaction,
        });
    }
    await Customer.destroy({
        where: { id: customerId, shop_id: shopId },
        transaction,
        individualHooks: true,
    });

    return {
        shopId,
        conversationsDeleted: conversationIds.length,
        messagesDeleted: messages.length,
        ordersAnonymized: orderIds.length,
        attachmentPaths: [...new Set(attachmentPaths)],
    };
}

async function resolveMappedCustomers(appScopedUserId, transaction) {
    const mappings = await MetaUserIdentity.findAll({
        where: {
            app_scoped_user_id: String(appScopedUserId),
            is_current_connection: true,
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
    });
    const resolved = [];
    const usableMappings = mappings.filter((mapping) => Boolean(mapping.page_scoped_user_id));
    const seen = new Set();
    for (const mapping of usableMappings) {
        const customer = await Customer.findOne({
            where: {
                shop_id: mapping.shop_id,
                channel_type: 'messenger',
                channel_user_id: mapping.page_scoped_user_id,
            },
            transaction,
            lock: transaction.LOCK.UPDATE,
        });
        if (!customer) continue;
        const key = `${mapping.channel_id}:${customer.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        resolved.push({ mapping, customer });
    }
    return { mappings, usableMappings, resolved };
}

async function processDeletionRequest({
    signedRequest,
    appScopedUserId,
    appSecret,
}) {
    const fingerprint = requestFingerprint(signedRequest);
    const code = confirmationCode(appSecret, fingerprint);
    const [request, created] = await MetaDataDeletionRequest.findOrCreate({
        where: { request_fingerprint: fingerprint },
        defaults: {
            request_fingerprint: fingerprint,
            identity_hash: identityHash(appSecret, appScopedUserId),
            confirmation_code_hash: confirmationCodeHash(code),
            status: 'PENDING',
        },
    });

    if (created) {
        await writeAudit('meta_deletion_request_received', request.id);
        await writeAudit('meta_deletion_signed_request_validated', request.id);
    }
    if (request.status === 'COMPLETED') {
        return { request, confirmationCode: code, repeated: true };
    }
    const staleBefore = new Date(Date.now() - PROCESSING_STALE_MS);
    const staleProcessing = request.status === 'PROCESSING' && (
        !request.started_at || new Date(request.started_at) < staleBefore
    );
    if (request.status === 'PROCESSING' && !staleProcessing) {
        return { request, confirmationCode: code, pending: true, repeated: true };
    }

    const resumeCompletedDataPhase = Boolean(request.data_phase_completed_at)
        && (request.status === 'FAILED' || staleProcessing);
    const processingToken = crypto.randomBytes(32).toString('hex');
    const processingState = {
        status: 'PROCESSING',
        processing_token: processingToken,
        started_at: new Date(),
        completed_at: null,
        failure_code: null,
        failure_detail: null,
    };
    if (!resumeCompletedDataPhase) {
        processingState.data_phase_completed_at = null;
    }
    const [claimed] = await MetaDataDeletionRequest.update(processingState, {
        where: {
            id: request.id,
            [Op.or]: [
                {
                    status: {
                        [Op.in]: ['PENDING', 'FAILED', 'IDENTITY_NOT_RESOLVED'],
                    },
                },
                {
                    status: 'PROCESSING',
                    [Op.or]: [
                        { started_at: null },
                        { started_at: { [Op.lt]: staleBefore } },
                    ],
                },
            ],
        },
    });
    if (claimed !== 1) {
        await request.reload();
        if (request.status === 'COMPLETED') {
            return { request, confirmationCode: code, repeated: true };
        }
        return { request, confirmationCode: code, pending: true, repeated: true };
    }
    Object.assign(request, processingState);

    let pendingAttachmentPaths = [];
    try {
        // The database transaction committed before a prior crash/failure. Resume
        // only the external attachment phase and completion audit.
        if (resumeCompletedDataPhase) {
            const cleanup = await cleanupOwnedAttachments(request.pending_attachment_paths);
            await sequelize.transaction(async (transaction) => {
                await fencedRequestUpdate(request, processingToken, {
                    attachments_deleted_count: request.attachments_deleted_count + cleanup.deleted,
                    pending_attachment_paths: cleanup.remaining,
                    status: cleanup.remaining.length ? 'FAILED' : 'COMPLETED',
                    processing_token: null,
                    failure_code: cleanup.remaining.length ? 'ATTACHMENT_CLEANUP_FAILED' : null,
                    failure_detail: cleanup.remaining.length
                        ? 'Server-owned attachment cleanup remains pending'
                        : null,
                    completed_at: cleanup.remaining.length ? null : new Date(),
                }, { transaction });
                if (!cleanup.remaining.length) {
                    await writeAudit('meta_deletion_completed', request.id, {
                        metadata: serializeDeletionStatus(request),
                        transaction,
                    });
                }
            });
            if (cleanup.remaining.length) {
                throw Object.assign(new Error('Attachment cleanup remains incomplete'), {
                    code: 'ATTACHMENT_CLEANUP_FAILED',
                });
            }
            return { request, confirmationCode: code, repeated: true };
        }

        await sequelize.transaction(async (transaction) => {
            const { mappings, usableMappings, resolved } = await resolveMappedCustomers(
                appScopedUserId,
                transaction,
            );

            if (mappings.length === 0 || usableMappings.length !== mappings.length) {
                await fencedRequestUpdate(request, processingToken, {
                    status: 'IDENTITY_NOT_RESOLVED',
                    processing_token: null,
                    matched_customer_count: 0,
                    conversations_deleted_count: 0,
                    messages_deleted_count: 0,
                    orders_anonymized_count: 0,
                    attachments_deleted_count: 0,
                    pending_attachment_paths: [],
                    failure_code: 'IDENTITY_MAPPING_UNAVAILABLE',
                    failure_detail: 'Legitimate Meta identity mapping is not yet available',
                    data_phase_completed_at: null,
                    completed_at: null,
                }, { transaction });
                await writeAudit('meta_deletion_identity_not_resolved', request.id, {
                    metadata: {
                        retryable: true,
                        mappings_found: mappings.length,
                        usable_mappings_found: usableMappings.length,
                    },
                    transaction,
                });
                return;
            }

            await writeAudit('meta_deletion_identity_resolved', request.id, {
                metadata: {
                    mappings_found: mappings.length,
                    customers_matched: resolved.length,
                },
                transaction,
            });

            const totals = {
                matchedCustomers: 0,
                conversationsDeleted: 0,
                messagesDeleted: 0,
                ordersAnonymized: 0,
            };
            const shops = new Set();
            for (const { mapping, customer } of resolved) {
                const result = await deleteCustomerData(
                    customer,
                    mapping,
                    request,
                    transaction,
                );
                totals.matchedCustomers += 1;
                totals.conversationsDeleted += result.conversationsDeleted;
                totals.messagesDeleted += result.messagesDeleted;
                totals.ordersAnonymized += result.ordersAnonymized;
                pendingAttachmentPaths.push(...result.attachmentPaths);
                shops.add(result.shopId);
            }

            pendingAttachmentPaths = [...new Set(pendingAttachmentPaths)];
            await fencedRequestUpdate(request, processingToken, {
                matched_customer_count: totals.matchedCustomers,
                conversations_deleted_count: totals.conversationsDeleted,
                messages_deleted_count: totals.messagesDeleted,
                orders_anonymized_count: totals.ordersAnonymized,
                pending_attachment_paths: pendingAttachmentPaths,
                data_phase_completed_at: new Date(),
            }, { transaction });

            for (const shopId of shops) {
                await writeAudit('meta_deletion_shop_data_removed', request.id, {
                    shopId,
                    metadata: {
                        conversations_deleted: totals.conversationsDeleted,
                        messages_deleted: totals.messagesDeleted,
                        orders_anonymized: totals.ordersAnonymized,
                    },
                    transaction,
                });
            }
            await MetaUserIdentity.destroy({
                where: { app_scoped_user_id: String(appScopedUserId) },
                transaction,
            });
        });

        if (request.status === 'IDENTITY_NOT_RESOLVED') {
            await opsAlert('Meta deletion identity not resolved', {
                detail: `Deletion request ${request.id} requires identity reconciliation`,
                level: 'warning',
                context: { requestId: request.id },
            });
            return {
                request,
                confirmationCode: code,
                unresolvedIdentity: true,
            };
        }

        const cleanup = await cleanupOwnedAttachments(pendingAttachmentPaths);
        await sequelize.transaction(async (transaction) => {
            await fencedRequestUpdate(request, processingToken, {
                attachments_deleted_count: cleanup.deleted,
                pending_attachment_paths: cleanup.remaining,
                status: cleanup.remaining.length ? 'FAILED' : 'COMPLETED',
                processing_token: null,
                failure_code: cleanup.remaining.length ? 'ATTACHMENT_CLEANUP_FAILED' : null,
                failure_detail: cleanup.remaining.length
                    ? 'Server-owned attachment cleanup remains pending'
                    : null,
                completed_at: cleanup.remaining.length ? null : new Date(),
            }, { transaction });
            if (!cleanup.remaining.length) {
                await writeAudit('meta_deletion_completed', request.id, {
                    metadata: serializeDeletionStatus(request),
                    transaction,
                });
            }
        });
        if (cleanup.remaining.length) {
            throw Object.assign(new Error('Attachment cleanup incomplete'), {
                code: 'ATTACHMENT_CLEANUP_FAILED',
            });
        }
        return { request, confirmationCode: code };
    } catch (err) {
        if (err.code === 'DELETION_CLAIM_LOST') {
            throw err;
        }
        const failureCode = err.code || 'DELETION_PROCESSING_FAILED';
        if (request.status !== 'FAILED' || request.failure_code !== 'ATTACHMENT_CLEANUP_FAILED') {
            await fencedRequestUpdate(request, processingToken, {
                status: 'FAILED',
                processing_token: null,
                failure_code: failureCode,
                failure_detail: failureCode === 'ATTACHMENT_CLEANUP_FAILED'
                    ? 'Server-owned attachment cleanup remains pending'
                    : 'Deletion processing failed before durable completion',
                completed_at: null,
            });
        }
        await writeAudit('meta_deletion_failed', request.id, {
            metadata: { failure_code: failureCode },
        }).catch((auditErr) => {
            logger.error('Failed to write deletion failure audit', {
                requestId: request.id,
                error: auditErr.message,
            });
        });
        throw err;
    }
}

async function getDeletionStatus(code) {
    if (!code || typeof code !== 'string' || !/^DEL-[A-Za-z0-9_-]{32}$/.test(code)) {
        return null;
    }
    const row = await MetaDataDeletionRequest.findOne({
        where: { confirmation_code_hash: confirmationCodeHash(code) },
    });
    return row ? serializeDeletionStatus(row) : null;
}

module.exports = {
    processDeletionRequest,
    getDeletionStatus,
    serializeDeletionStatus,
    _private: {
        cleanupOwnedAttachments,
        collectOwnedAttachmentPaths,
        confirmationCode,
        confirmationCodeHash,
        identityHash,
        ownedAttachmentPath,
        requestFingerprint,
        resolveMappedCustomers,
        fencedRequestUpdate,
    },
};
