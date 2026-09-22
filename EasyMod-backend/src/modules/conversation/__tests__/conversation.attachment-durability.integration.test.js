'use strict';

const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');

const uploadRoot = path.resolve(__dirname, '../../../../.attachment-integration-uploads');
process.env.EASYMOD_UPLOAD_ROOT = uploadRoot;
process.env.PUBLIC_BASE_URL = 'https://assets.test.invalid';

const { sequelize } = require('../../../utils/database/database-setup');
const conversationService = require('../conversation.service');
const {
    absolutePathForKey,
    mintAttachmentUrl,
} = require('../attachment-storage');

const ids = {
    tenant: randomUUID(),
    shop: randomUUID(),
    customer: randomUUID(),
    conversation: randomUUID(),
    message: randomUUID(),
};
const storageKey = `${ids.shop}/historical.png`;

describe('durable conversation attachment projection on PostgreSQL', () => {
    let originalMetadata;

    beforeAll(async () => {
        const attachmentPath = absolutePathForKey(storageKey);
        await fs.mkdir(path.dirname(attachmentPath), { recursive: true });
        await fs.writeFile(attachmentPath, Buffer.from('historical attachment bytes'));

        const expiredUrl = mintAttachmentUrl({
            shopId: ids.shop,
            fileName: 'historical.png',
            baseUrl: 'https://assets.test.invalid',
            now: Math.floor(Date.now() / 1000) - 3600,
        });
        originalMetadata = {
            message_type: 'image',
            image_url: expiredUrl,
            file_url: expiredUrl,
            attachment_source: 'inbox_upload',
            attachment_storage_key: storageKey,
            attachment_available: true,
        };

        await sequelize.query(
            `INSERT INTO public.tenants (id, name) VALUES (:tenantId, 'attachment-durability-tenant')`,
            { replacements: { tenantId: ids.tenant } },
        );
        await sequelize.query(
            `INSERT INTO public.shops (id, unique_code, tenant_id, shop_name, name)
             VALUES (:shopId, :uniqueCode, :tenantId, 'attachment-durability-shop', 'attachment-durability-shop')`,
            {
                replacements: {
                    shopId: ids.shop,
                    uniqueCode: `ad${process.pid}${ids.shop.slice(0, 8)}`,
                    tenantId: ids.tenant,
                },
            },
        );
        await sequelize.query(
            `INSERT INTO public.customers (id, shop_id, name, channel_type, channel_user_id)
             VALUES (:customerId, :shopId, 'Attachment Customer', 'messenger', :channelUserId)`,
            {
                replacements: {
                    customerId: ids.customer,
                    shopId: ids.shop,
                    channelUserId: `attachment-${ids.customer.slice(0, 8)}`,
                },
            },
        );
        await sequelize.query(
            `INSERT INTO public.conversations
                (id, shop_id, customer_id, channel, role, message, status, metadata)
             VALUES (:conversationId, :shopId, :customerId, 'messenger', 'user', '[Attachment]', 'active', '{}')`,
            {
                replacements: {
                    conversationId: ids.conversation,
                    shopId: ids.shop,
                    customerId: ids.customer,
                },
            },
        );
        await sequelize.query(
            `INSERT INTO public.messages
                (id, conversation_id, content, sender, external_id, metadata, created_at)
             VALUES (:messageId, :conversationId, '[Attachment]', 'customer', :externalId, :metadata, :createdAt)`,
            {
                replacements: {
                    messageId: ids.message,
                    conversationId: ids.conversation,
                    externalId: `attachment-${ids.message}`,
                    metadata: JSON.stringify(originalMetadata),
                    createdAt: new Date('2026-09-07T09:00:00Z'),
                },
            },
        );
    });

    afterAll(async () => {
        await sequelize.query('DELETE FROM public.messages WHERE id = :messageId', {
            replacements: { messageId: ids.message },
        });
        await sequelize.query('DELETE FROM public.conversations WHERE id = :conversationId', {
            replacements: { conversationId: ids.conversation },
        });
        await sequelize.query('DELETE FROM public.customers WHERE id = :customerId', {
            replacements: { customerId: ids.customer },
        });
        await sequelize.query('DELETE FROM public.shops WHERE id = :shopId', {
            replacements: { shopId: ids.shop },
        });
        await sequelize.query('DELETE FROM public.tenants WHERE id = :tenantId', {
            replacements: { tenantId: ids.tenant },
        });
        await fs.rm(uploadRoot, { recursive: true, force: true });
    });

    test('reload returns a fresh URL while leaving the message row byte-identical', async () => {
        const [beforeRows] = await sequelize.query(
            'SELECT metadata FROM public.messages WHERE id = :messageId',
            { replacements: { messageId: ids.message } },
        );
        const before = JSON.stringify(beforeRows[0].metadata);

        const beforeExpiry = Math.floor(Date.now() / 1000) + 15 * 60;
        const result = await conversationService.getMessages(ids.conversation, ids.shop);
        const projected = result.messages.find((message) => message.id === ids.message);
        const afterExpiry = Math.floor(Date.now() / 1000) + 15 * 60;
        const [afterRows] = await sequelize.query(
            'SELECT metadata FROM public.messages WHERE id = :messageId',
            { replacements: { messageId: ids.message } },
        );

        expect(projected.metadata.attachment_storage_key).toBe(storageKey);
        expect(projected.metadata.attachment_available).toBe(true);
        expect(projected.metadata.image_url).not.toBe(originalMetadata.image_url);
        const expires = Number(new URL(projected.metadata.image_url).searchParams.get('expires'));
        expect(expires).toBeGreaterThanOrEqual(beforeExpiry);
        expect(expires).toBeLessThanOrEqual(afterExpiry);
        expect(JSON.stringify(afterRows[0].metadata)).toBe(before);
    });
});
