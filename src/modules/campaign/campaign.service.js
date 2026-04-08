const { Campaign, Customer, Order, UserShop } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { Op } = require('sequelize');

const CAMPAIGN_MAX_RECIPIENTS = Number(process.env.CAMPAIGN_MAX_RECIPIENTS || 500);

const hasCampaignConsent = (customer) => {
    const metadata = customer?.metadata || {};

    // Consent can be expressed with any of these metadata flags.
    if (metadata.marketing_opt_out === true || metadata.unsubscribed === true) {
        return false;
    }

    if (
        metadata.marketing_opt_in === true ||
        metadata.campaign_consent === true ||
        metadata.consent === true
    ) {
        return true;
    }

    return false;
};

/**
 * Verify user has access to the shop
 */
const verifyShopAccess = async (userId, shopId) => {
    const userShop = await UserShop.findOne({
        where: { user_id: userId, shop_id: shopId, is_active: true }
    });
    if (!userShop) {
        throw new AppError('You do not have access to this shop', 403);
    }
    return userShop;
};

/**
 * Create a draft campaign
 */
const createCampaign = async (shopId, data) => {
    const { name, message_template, segment_filter } = data;

    if (!name || !message_template) {
        throw new AppError('name and message_template are required', 400);
    }

    const campaign = await Campaign.create({
        shop_id: shopId,
        name,
        message_template,
        segment_filter: segment_filter || {},
        status: 'draft'
    });

    return campaign;
};

/**
 * Schedule a campaign — set status to 'scheduled' with a future date
 */
const scheduleCampaign = async (shopId, campaignId, scheduledAt) => {
    if (!scheduledAt) {
        throw new AppError('scheduledAt is required', 400);
    }

    const campaign = await Campaign.findOne({ where: { id: campaignId, shop_id: shopId } });
    if (!campaign) {
        throw new AppError('Campaign not found', 404);
    }

    if (!['draft', 'scheduled'].includes(campaign.status)) {
        throw new AppError(`Cannot schedule a campaign with status '${campaign.status}'`, 400);
    }

    await campaign.update({ status: 'scheduled', scheduled_at: new Date(scheduledAt) });
    return campaign;
};

/**
 * List all campaigns for a shop
 */
const getCampaigns = async (shopId) => {
    const campaigns = await Campaign.findAll({
        where: { shop_id: shopId },
        order: [['created_at', 'DESC']]
    });
    return campaigns;
};

/**
 * Get stats for a single campaign
 */
const getCampaignStats = async (shopId, campaignId) => {
    const campaign = await Campaign.findOne({ where: { id: campaignId, shop_id: shopId } });
    if (!campaign) {
        throw new AppError('Campaign not found', 404);
    }

    return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        scheduled_at: campaign.scheduled_at,
        total_recipients: campaign.total_recipients,
        sent_count: campaign.sent_count,
        failed_count: campaign.failed_count,
        created_at: campaign.created_at,
        updated_at: campaign.updated_at
    };
};

/**
 * Run a campaign — stub that sets status to 'running', queries matching customers,
 * and increments total_recipients. Actual message sending is a background job (TODO).
 */
const runCampaign = async (shopId, campaignId) => {
    const campaign = await Campaign.findOne({ where: { id: campaignId, shop_id: shopId } });
    if (!campaign) {
        throw new AppError('Campaign not found', 404);
    }

    if (!['draft', 'scheduled'].includes(campaign.status)) {
        throw new AppError(`Cannot run a campaign with status '${campaign.status}'`, 400);
    }

    // Build customer query from segment_filter
    const customerWhere = { shop_id: shopId };
    const {
        minOrders,
        paymentMethod,
        requireConsent = true,
        recipientCap = CAMPAIGN_MAX_RECIPIENTS
    } = campaign.segment_filter || {};

    // Find matching customers
    let matchingCustomers;
    if (minOrders && minOrders > 0) {
        // Customers with at least minOrders orders matching optional payment method filter
        const orderWhere = { shop_id: shopId };
        if (paymentMethod) {
            orderWhere.payment_method = paymentMethod;
        }

        const orders = await Order.findAll({
            where: orderWhere,
            attributes: ['customer_id', [Order.sequelize.fn('COUNT', Order.sequelize.col('id')), 'order_count']],
            group: ['customer_id'],
            having: {
                customer_id: { [Op.ne]: null },
                order_count: { [Op.gte]: Number(minOrders) }
            }
        });

        const eligibleIds = orders.map((o) => o.customer_id).filter(Boolean);

        customerWhere.id = { [Op.in]: eligibleIds };
    } else if (paymentMethod) {
        const ordersWithMethod = await Order.findAll({
            where: { shop_id: shopId, payment_method: paymentMethod, customer_id: { [Op.ne]: null } },
            attributes: ['customer_id'],
            group: ['customer_id']
        });
        const eligibleIds = ordersWithMethod.map(o => o.customer_id);
        customerWhere.id = { [Op.in]: eligibleIds };
    }

    matchingCustomers = await Customer.findAll({
        where: customerWhere,
        attributes: ['id', 'metadata']
    });

    const eligibleCustomers = requireConsent
        ? matchingCustomers.filter(hasCampaignConsent)
        : matchingCustomers;

    const cappedRecipients = Math.min(Number(recipientCap) || CAMPAIGN_MAX_RECIPIENTS, CAMPAIGN_MAX_RECIPIENTS);

    if (eligibleCustomers.length > cappedRecipients) {
        throw new AppError(
            `Campaign recipient limit exceeded: ${eligibleCustomers.length} recipients selected, max allowed is ${cappedRecipients}`,
            429
        );
    }

    const totalRecipients = eligibleCustomers.length;

    // Set status to running and record total recipients
    await campaign.update({ status: 'running', total_recipients: totalRecipients });

    // TODO: Enqueue actual message sending as a background job

    return campaign;
};

module.exports = {
    createCampaign,
    scheduleCampaign,
    getCampaigns,
    getCampaignStats,
    runCampaign
};
