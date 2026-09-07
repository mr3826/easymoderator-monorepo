'use strict';

const { randomUUID } = require('crypto');
const { sequelize } = require('../../utils/database/database-setup');
const migration = require('../migrations/20260908_001_remove_messages_updated_at');
const conversationService = require('../../modules/conversation/conversation.service');

const ids = {
    tenant: randomUUID(),
    shop: randomUUID(),
    customer: randomUUID(),
    conversation: randomUUID(),
    referencedMessage: randomUUID(),
    inboundMessage: randomUUID(),
};

const productionIds = {
    tenant: randomUUID(),
    shop: randomUUID(),
    customer: randomUUID(),
    conversation: randomUUID(),
};

describe('messages.updated_at drift repair on PostgreSQL', () => {
    beforeAll(async () => {
        await sequelize.query(
            'ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
        );
        await migration.up(sequelize);

        await sequelize.query(
            `INSERT INTO public.tenants (id, name) VALUES (:tenantId, 'messages-drift-test-tenant')`,
            { replacements: { tenantId: ids.tenant } },
        );
        await sequelize.query(
            `INSERT INTO public.shops (id, unique_code, tenant_id, shop_name, name)
             VALUES (:shopId, :uniqueCode, :tenantId, 'messages-drift-test-shop', 'messages-drift-test-shop')`,
            {
                replacements: {
                    shopId: ids.shop,
                    uniqueCode: `md${process.pid}${ids.shop.slice(0, 8)}`,
                    tenantId: ids.tenant,
                },
            },
        );
        await sequelize.query(
            `INSERT INTO public.customers (id, shop_id, name, channel_type, channel_user_id)
             VALUES (:customerId, :shopId, 'Schema Drift Customer', 'messenger', :channelUserId)`,
            {
                replacements: {
                    customerId: ids.customer,
                    shopId: ids.shop,
                    channelUserId: `messages-drift-${ids.customer.slice(0, 8)}`,
                },
            },
        );
        await sequelize.query(
            `INSERT INTO public.conversations
                (id, shop_id, customer_id, channel, role, message, status, metadata)
             VALUES (:conversationId, :shopId, :customerId, 'messenger', 'user', 'L', 'active', '{}')`,
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
             VALUES (:id, :conversationId, 'Which size would you like?', 'business', :externalId, :metadata, :createdAt)`,
            {
                replacements: {
                    id: ids.referencedMessage,
                    conversationId: ids.conversation,
                    externalId: 'mid.messages-drift-reference',
                    metadata: JSON.stringify({ message_type: 'text' }),
                    createdAt: new Date('2026-09-08T10:00:00Z'),
                },
            },
        );
        await sequelize.query(
            `INSERT INTO public.messages
                (id, conversation_id, content, sender, external_id, metadata, created_at)
             VALUES (:id, :conversationId, 'L', 'customer', :externalId, :metadata, :createdAt)`,
            {
                replacements: {
                    id: ids.inboundMessage,
                    conversationId: ids.conversation,
                    externalId: 'mid.messages-drift-inbound',
                    metadata: JSON.stringify({
                        message_type: 'image',
                        image_url: 'https://cdn.example/reply.png',
                        attachments: [
                            { type: 'image', url: 'https://cdn.example/reply.png' },
                            { type: 'file', url: 'https://cdn.example/size-guide.pdf', name: 'size-guide.pdf' },
                        ],
                        reply_to_provider_message_id: 'mid.messages-drift-reference',
                        reply_to_internal_message_id: ids.referencedMessage,
                        reply_to: {
                            provider_message_id: 'mid.messages-drift-reference',
                            internal_message_id: ids.referencedMessage,
                            status: 'resolved',
                            sender: 'agent',
                            content: 'Which size would you like?',
                        },
                    }),
                    createdAt: new Date('2026-09-08T10:01:00Z'),
                },
            },
        );
    });

    afterAll(async () => {
        await sequelize.query('DELETE FROM public.messages WHERE conversation_id = :conversationId', {
            replacements: { conversationId: ids.conversation },
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
    });

    test('removes the legacy column', async () => {
        const [columns] = await sequelize.query(`
            SELECT column_name
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'messages'
               AND column_name = 'updated_at'
        `);
        expect(columns).toHaveLength(0);
    });

    test('getMessages reads replies and every attachment from the repaired table', async () => {
        const result = await conversationService.getMessages(ids.conversation, ids.shop);
        const inbound = result.messages.find((message) => message.id === ids.inboundMessage);

        expect(result.messages).toHaveLength(2);
        expect(inbound).toEqual(expect.objectContaining({
            reply_to: expect.objectContaining({
                provider_message_id: 'mid.messages-drift-reference',
                internal_message_id: ids.referencedMessage,
            }),
        }));
        expect(inbound.metadata.attachments).toHaveLength(2);
        expect(inbound.metadata.attachments.map(({ type }) => type)).toEqual(['image', 'file']);
    });

    test('getConversationById returns the detail projection from the repaired table', async () => {
        const detail = await conversationService.getConversationById(ids.conversation, ids.shop);

        expect(detail).toEqual(expect.objectContaining({
            id: ids.conversation,
            status: 'active',
        }));
        expect(detail.messages).toHaveLength(2);
    });

    test('a conversation from another shop remains a 404', async () => {
        await expect(conversationService.getMessages(ids.conversation, randomUUID()))
            .rejects.toMatchObject({ status: 404, code: 'CONVERSATION_NOT_FOUND' });
    });
});

describe('messages.updated_at absent on production-shaped tables', () => {
    let migrationState;

    beforeAll(async () => {
        const [beforeMigration] = await sequelize.query(`
            SELECT column_name
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'messages'
               AND column_name = 'updated_at'
        `);

        await migration.up(sequelize);

        const [afterMigration] = await sequelize.query(`
            SELECT column_name
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'messages'
               AND column_name = 'updated_at'
        `);
        migrationState = {
            before: beforeMigration.length,
            after: afterMigration.length,
        };

        await sequelize.query(
            `INSERT INTO public.tenants (id, name) VALUES (:tenantId, 'messages-production-shape-tenant')`,
            { replacements: { tenantId: productionIds.tenant } },
        );
        await sequelize.query(
            `INSERT INTO public.shops (id, unique_code, tenant_id, shop_name, name)
             VALUES (:shopId, :uniqueCode, :tenantId, 'messages-production-shape-shop', 'messages-production-shape-shop')`,
            {
                replacements: {
                    shopId: productionIds.shop,
                    uniqueCode: `mps${process.pid}${productionIds.shop.slice(0, 8)}`,
                    tenantId: productionIds.tenant,
                },
            },
        );
        await sequelize.query(
            `INSERT INTO public.customers (id, shop_id, name, channel_type, channel_user_id)
             VALUES (:customerId, :shopId, 'Production Shape Customer', 'messenger', :channelUserId)`,
            {
                replacements: {
                    customerId: productionIds.customer,
                    shopId: productionIds.shop,
                    channelUserId: `messages-production-${productionIds.customer.slice(0, 8)}`,
                },
            },
        );
        await sequelize.query(
            `INSERT INTO public.conversations
                (id, shop_id, customer_id, channel, role, message, status, metadata)
             VALUES (:conversationId, :shopId, :customerId, 'messenger', 'user', 'L', 'active', '{}')`,
            {
                replacements: {
                    conversationId: productionIds.conversation,
                    shopId: productionIds.shop,
                    customerId: productionIds.customer,
                },
            },
        );
    });

    afterAll(async () => {
        await sequelize.query('DELETE FROM public.conversations WHERE id = :conversationId', {
            replacements: { conversationId: productionIds.conversation },
        });
        await sequelize.query('DELETE FROM public.customers WHERE id = :customerId', {
            replacements: { customerId: productionIds.customer },
        });
        await sequelize.query('DELETE FROM public.shops WHERE id = :shopId', {
            replacements: { shopId: productionIds.shop },
        });
        await sequelize.query('DELETE FROM public.tenants WHERE id = :tenantId', {
            replacements: { tenantId: productionIds.tenant },
        });
    });

    test('migration is a no-op when production already lacks the column', () => {
        expect(migrationState).toEqual({ before: 0, after: 0 });
    });

    test('getMessages succeeds without a messages.updated_at column', async () => {
        await expect(conversationService.getMessages(
            productionIds.conversation,
            productionIds.shop,
        )).resolves.toEqual(expect.objectContaining({
            messages: [],
            pagination: expect.objectContaining({ total: 0 }),
        }));
    });

    test('getConversationById succeeds without a messages.updated_at column', async () => {
        await expect(conversationService.getConversationById(
            productionIds.conversation,
            productionIds.shop,
        )).resolves.toEqual(expect.objectContaining({
            id: productionIds.conversation,
            status: 'active',
        }));
    });
});

afterAll(async () => {
    await sequelize.close();
});
