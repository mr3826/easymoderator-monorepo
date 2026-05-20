require('module-alias/register');
require('dotenv').config();

const env = process.env.NODE_ENV || 'development';
if (!process.env.DATABASE_URL && env !== 'production') {
    process.env.DATABASE_URL = 'sqlite:./database.sqlite';
}

const { Op } = require('sequelize');

const entities = require('../modules/entities');
const { sequelize } = require('../utils/database/database-setup');

const { User, Shop, UserShop, Customer, Conversation, Message } = entities;

const TEST_SEED_TAG = 'testing-conversation-seed-v1';
const TEST_TITLE_PREFIX = '[TEST]';
const DEFAULT_CONVERSATION_COUNT = 3;

function hasColumn(columns, name) {
    return Boolean(columns && Object.prototype.hasOwnProperty.call(columns, name));
}

async function getSchemaCapabilities() {
    const queryInterface = sequelize.getQueryInterface();

    const [conversationColumns, messageColumns, customerColumns, customerIndexes] = await Promise.all([
        queryInterface.describeTable('conversations'),
        queryInterface.describeTable('messages'),
        queryInterface.describeTable('customers'),
        queryInterface.showIndex('customers')
    ]);

    const singleCustomerPerShop = customerIndexes.some((index) => {
        if (!index.unique || !Array.isArray(index.fields) || index.fields.length !== 1) {
            return false;
        }
        return index.fields[0].attribute === 'shop_id';
    });

    return {
        conversationColumns,
        messageColumns,
        customerColumns,
        singleCustomerPerShop,
        hasConversationMetadata: hasColumn(conversationColumns, 'metadata'),
        hasMessageMetadata: hasColumn(messageColumns, 'metadata'),
        hasCustomerMetadata: hasColumn(customerColumns, 'metadata')
    };
}

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i += 1) {
        const current = argv[i];
        const next = argv[i + 1];

        if (current === '--email' && next) {
            args.email = next;
            i += 1;
            continue;
        }

        if (current === '--shop-id' && next) {
            args.shopId = next;
            i += 1;
            continue;
        }

        if (current === '--count' && next) {
            const parsed = Number.parseInt(next, 10);
            if (!Number.isNaN(parsed) && parsed > 0) {
                args.count = parsed;
            }
            i += 1;
            continue;
        }

        if (current === '--force') {
            args.force = true;
        }
    }

    return args;
}

async function resolveTargetShop({ email, shopId }) {
    if (shopId) {
        const explicitShop = await Shop.findByPk(shopId);
        if (!explicitShop) {
            throw new Error(`Shop not found for --shop-id=${shopId}`);
        }
        return { shop: explicitShop, user: null, via: 'shop-id' };
    }

    if (email) {
        const user = await User.findOne({ where: { email } });
        if (!user) {
            throw new Error(`User not found for --email=${email}`);
        }

        const preferredShop = user.last_logged_shop_id
            ? await Shop.findByPk(user.last_logged_shop_id)
            : null;

        if (preferredShop) {
            return { shop: preferredShop, user, via: 'email:last_logged_shop_id' };
        }

        const membership = await UserShop.findOne({
            where: { user_id: user.id, is_active: true },
            order: [['created_at', 'DESC']]
        });

        if (!membership) {
            throw new Error(`No active shop membership found for --email=${email}`);
        }

        const shop = await Shop.findByPk(membership.shop_id);
        if (!shop) {
            throw new Error(`Shop not found for user membership: ${membership.shop_id}`);
        }

        return { shop, user, via: 'email:user_shop_membership' };
    }

    const lastLoggedInUser = await User.findOne({
        where: { last_logged_shop_id: { [Op.ne]: null } },
        order: [['updated_at', 'DESC']]
    });

    if (lastLoggedInUser?.last_logged_shop_id) {
        const shop = await Shop.findByPk(lastLoggedInUser.last_logged_shop_id);
        if (shop) {
            return { shop, user: lastLoggedInUser, via: 'latest:last_logged_shop_id' };
        }
    }

    const latestMembership = await UserShop.findOne({
        where: { is_active: true },
        order: [['updated_at', 'DESC']]
    });

    if (latestMembership) {
        const user = await User.findByPk(latestMembership.user_id);
        const shop = await Shop.findByPk(latestMembership.shop_id);
        if (shop) {
            return { shop, user, via: 'latest:user_shop_membership' };
        }
    }

    throw new Error('Unable to resolve target shop. Provide --email or --shop-id.');
}

function createConversationBlueprints(shopName) {
    return [
        {
            channel: 'messenger',
            customer: {
                name: 'Rafiul Islam',
                channel_type: 'messenger',
                channel_user_id: 'seed-msgr-testing-01',
                phone: '+8801710001001',
                language_preference: 'banglish'
            },
            status: 'unanswered',
            title: `${TEST_TITLE_PREFIX} Size help for Premium Panjabi`,
            intent: 'product_inquiry',
            conversationSummary: 'ভাইয়া, XL সাইজে বুক কত ইঞ্চি?',
            messages: [
                { sender: 'customer', content: 'Assalamu alaikum! Premium Panjabi er XL size e chest measurement koto?' },
                { sender: 'business', content: 'Walaikum assalam! XL chest 44 inch, length 40 inch. চাইলে আমি size chart image দিতে পারি.', message_type: 'template', metadata: { template_key: 'size_reply' } },
                { sender: 'customer', content: 'Great, navy color e available?' }
            ]
        },
        {
            channel: 'instagram',
            customer: {
                name: 'Nusrat Jahan',
                channel_type: 'instagram',
                channel_user_id: 'seed-ig-testing-02',
                phone: '+8801810002002',
                language_preference: 'english'
            },
            status: 'pending_order',
            title: `${TEST_TITLE_PREFIX} Delivery ETA check`,
            intent: 'delivery_query',
            conversationSummary: 'Order ta kalke pawa jabe?',
            messages: [
                { sender: 'customer', content: 'Hi, I placed an order yesterday. Can I get it by tomorrow in Dhanmondi?' },
                { sender: 'business', content: 'Yes, inside Dhaka delivery is typically within 24 hours. Please share your order phone number.' },
                { sender: 'customer', content: '01711001100' },
                { sender: 'business', content: 'Thanks! I checked. Your parcel is out for dispatch and should arrive tomorrow afternoon.', message_type: 'text' }
            ]
        },
        {
            channel: 'instagram',
            customer: {
                name: 'Tanmoy Dutta',
                channel_type: 'instagram',
                channel_user_id: 'seed-ig-testing-03',
                language_preference: 'bangla'
            },
            status: 'active',
            title: `${TEST_TITLE_PREFIX} New drop question - ${shopName}`,
            intent: 'catalog_browse',
            conversationSummary: 'নতুন কালেকশন কবে আসবে?',
            messages: [
                { sender: 'customer', content: 'ভাই, ঈদ কালেকশনের নতুন ড্রপ কবে আসবে?' },
                { sender: 'business', content: 'ধন্যবাদ! আগামী শুক্রবার নতুন কালেকশন লাইভ হবে। চাইলে আমি রিমাইন্ডার সেট করে দিচ্ছি।', message_type: 'template', metadata: { template_key: 'new_drop_reminder' } },
                { sender: 'customer', content: 'Ok, আমাকে রিমাইন্ডার দিন।' }
            ]
        }
    ];
}

async function findOrCreateCustomer(shopId, customerData, capabilities) {
    if (capabilities.singleCustomerPerShop) {
        const onePerShopCustomer = await Customer.findOne({ where: { shop_id: shopId } });
        if (onePerShopCustomer) {
            return onePerShopCustomer;
        }
    }

    const matchers = [{ channel_user_id: customerData.channel_user_id }];
    if (customerData.phone) {
        matchers.push({ phone: customerData.phone });
    }
    if (customerData.email) {
        matchers.push({ email: customerData.email });
    }

    const existingCustomer = await Customer.findOne({
        where: {
            shop_id: shopId,
            [Op.or]: matchers
        }
    });

    if (existingCustomer) {
        return existingCustomer;
    }

    const payload = {
        shop_id: shopId,
        name: customerData.name,
        channel_type: customerData.channel_type,
        channel_user_id: customerData.channel_user_id,
        language_preference: customerData.language_preference || null,
        phone: customerData.phone || null,
        email: customerData.email || null,
        last_active: new Date()
    };

    if (capabilities.hasCustomerMetadata) {
        payload.metadata = {
            seeded: true,
            seed_tag: TEST_SEED_TAG
        };
    }

    const fields = Object.keys(payload).filter((key) => hasColumn(capabilities.customerColumns, key));
    return Customer.create(payload, { fields });
}

async function seedConversationWithMessages({ shopId, blueprint, now, capabilities }) {
    const customer = await findOrCreateCustomer(shopId, blueprint.customer, capabilities);

    const conversationWhere = {
        shop_id: shopId,
        customer_id: customer.id
    };

    if (hasColumn(capabilities.conversationColumns, 'title')) {
        conversationWhere.title = blueprint.title;
    } else if (hasColumn(capabilities.conversationColumns, 'message')) {
        conversationWhere.message = blueprint.conversationSummary;
    }

    let conversation = await Conversation.findOne({ where: conversationWhere });

    if (!conversation) {
        const conversationPayload = {
            shop_id: shopId,
            customer_id: customer.id,
            channel: blueprint.channel,
            title: blueprint.title,
            status: blueprint.status,
            role: 'user',
            message: blueprint.conversationSummary,
            intent: blueprint.intent,
            confidence: 92,
            llm_used: false,
            cache_hit: false,
            keyword_match: true,
            hitl: false
        };

        if (capabilities.hasConversationMetadata) {
            conversationPayload.metadata = {
                seeded: true,
                seed_tag: TEST_SEED_TAG,
                unreadCount: 1,
                status: blueprint.status
            };
        }

        const conversationFields = Object.keys(conversationPayload).filter(
            (key) => hasColumn(capabilities.conversationColumns, key)
        );

        conversation = await Conversation.create(conversationPayload, { fields: conversationFields });
    }

    const existingMessages = await Message.count({ where: { conversation_id: conversation.id } });

    if (existingMessages === 0) {
        let minuteOffset = 0;
        for (const message of blueprint.messages) {
            const createdAt = new Date(now.getTime() + (minuteOffset * 60 * 1000));
            minuteOffset += 2;

            const messagePayload = {
                conversation_id: conversation.id,
                content: message.content,
                sender: message.sender,
                message_tag: message.message_tag || null,
                created_at: createdAt
            };

            if (capabilities.hasMessageMetadata) {
                messagePayload.metadata = {
                    seeded: true,
                    seed_tag: TEST_SEED_TAG,
                    message_type: message.message_type || 'text',
                    ...(message.metadata || {})
                };
            }

            const messageFields = Object.keys(messagePayload).filter(
                (key) => hasColumn(capabilities.messageColumns, key)
            );

            await Message.create(messagePayload, { fields: messageFields });
        }
    }

    return { conversationId: conversation.id, customerId: customer.id, existingMessages };
}

async function run() {
    const args = parseArgs(process.argv);
    const requestedCount = args.count || DEFAULT_CONVERSATION_COUNT;

    await sequelize.authenticate();
    const capabilities = await getSchemaCapabilities();

    const target = await resolveTargetShop(args);
    const targetShopId = target.shop.id;

    console.log('Target resolved:');
    console.log(`  shop_id: ${targetShopId}`);
    console.log(`  shop_name: ${target.shop.shop_name || target.shop.name}`);
    console.log(`  source: ${target.via}`);
    if (target.user) {
        console.log(`  user_email: ${target.user.email}`);
    }

    let alreadySeededCount = 0;
    if (capabilities.hasConversationMetadata) {
        const existingConversations = await Conversation.findAll({
            where: { shop_id: targetShopId },
            attributes: ['id', 'metadata']
        });
        alreadySeededCount = existingConversations.filter(
            (row) => row.metadata && row.metadata.seed_tag === TEST_SEED_TAG
        ).length;
    } else if (hasColumn(capabilities.conversationColumns, 'title')) {
        alreadySeededCount = await Conversation.count({
            where: {
                shop_id: targetShopId,
                title: { [Op.like]: `${TEST_TITLE_PREFIX}%` }
            }
        });
    }

    if (alreadySeededCount > 0 && !args.force) {
        console.log(`Skipped: found ${alreadySeededCount} existing seeded conversation(s).`);
        console.log('Use --force to seed again.');
        return;
    }

    const blueprints = createConversationBlueprints(target.shop.shop_name || target.shop.name).slice(0, requestedCount);

    const now = new Date();
    const results = [];
    for (const blueprint of blueprints) {
        const seeded = await seedConversationWithMessages({
            shopId: targetShopId,
            blueprint,
            now,
            capabilities
        });
        results.push(seeded);
    }

    console.log(`Created/ensured ${results.length} seeded conversation(s) for testing.`);
    results.forEach((row, idx) => {
        console.log(`  ${idx + 1}. conversation_id=${row.conversationId} customer_id=${row.customerId}`);
    });

    if (capabilities.hasConversationMetadata) {
        console.log(`Done. These records are tagged with metadata.seed_tag=${TEST_SEED_TAG}`);
    } else {
        console.log(`Done. These records can be identified by title prefix: ${TEST_TITLE_PREFIX}`);
    }
}

run()
    .catch((error) => {
        console.error('Failed to seed conversations:', error.message);
        if (Array.isArray(error.errors)) {
            error.errors.forEach((item, index) => {
                console.error(`  [${index + 1}] ${item.message} (path: ${item.path})`);
            });
        }
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            await sequelize.close();
        } catch (closeError) {
            console.error('Error closing database connection:', closeError.message);
        }
    });
