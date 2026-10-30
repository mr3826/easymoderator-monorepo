'use strict';

// MW-V1 Phase 6 — controlled merchant tags (doc 05). Vocabulary is bounded,
// shop-scoped, case-insensitively unique; assignment is a replace-set with
// idempotent rows; DERIVED statuses are blocklisted from becoming manual
// knobs. Nothing here reads message content — tags are merchant-entered.

const { AppError } = require('../../utils/AppError');
const { Op } = require('sequelize');
const {
    CustomerTag, CustomerTagAssignment, Customer, UserShop, AuditLog,
} = require('../entities');

const MAX_TAG_LENGTH = 30;
const MAX_TAGS_PER_SHOP = 40;
const MAX_TAGS_PER_CUSTOMER = 15;

// Derived engine facts are never manual tags (mission §10.1). Word-boundary
// match against normalized lowercase input.
const RESERVED = /(repeat\s*buyer|at\s*risk|rto|fraud|scammer|blacklist|whitelist|interested|return\s*history|inactive|vip)/;

const fail = (message, code, statusCode) => {
    const error = new AppError(message, statusCode);
    error.code = code;
    error.statusCode = statusCode; // see notes service: .status alone does not survive reply()
    throw error;
};

const serializeTag = (row) => ({
    id: row.id,
    shop_id: row.shop_id,
    name: row.name,
    created_by: row.created_by ?? null,
    usage_count: row.usage_count ?? undefined,
});

const privileged = (actor) => ['owner', 'admin'].includes(String(actor?.role || '').toLowerCase());

async function requireActiveMembership(shopId, actor) {
    if (typeof UserShop?.findOne !== 'function') fail('Membership check unavailable', 'MEMBERSHIP_CHECK_UNAVAILABLE', 503);
    const member = await UserShop.findOne({ where: { user_id: actor.userId, shop_id: shopId, is_active: true } });
    if (!member) fail('You do not have access to this shop', 'FORBIDDEN', 403);
}

const audit = async (action, shopId, actor, extra, transaction) => {
    if (typeof AuditLog?.create !== 'function') {
        fail('Customer tag audit storage unavailable', 'TAG_AUDIT_UNAVAILABLE', 503);
    }
    try {
        await AuditLog.create({
            user_id: actor?.userId || null,
            shop_id: shopId,
            action,
            resource_type: 'customer_tags',
            resource_id: extra?.customer_id || extra?.tag_id || null,
            metadata: extra,
        }, transaction ? { transaction } : {});
    } catch (_) {
        fail('Customer tag audit write failed', 'TAG_AUDIT_FAILED', 503);
    }
};

const withTagAuditTransaction = async (callback) => {
    const sequelize = CustomerTag?.sequelize || CustomerTagAssignment?.sequelize;
    if (!sequelize || typeof sequelize.transaction !== 'function') {
        fail('Customer tag transaction unavailable', 'TAG_TRANSACTION_UNAVAILABLE', 503);
    }
    return sequelize.transaction(callback);
};

async function listTags({ shopId }, actor) {
    await requireActiveMembership(shopId, actor);
    const rows = await CustomerTag.findAll({
        where: { shop_id: shopId },
        order: [['name_lower', 'ASC']],
    });
    // One grouped count query for usage; never per-tag (no N+1).
    let usageBy = new Map();
    if (rows.length && typeof CustomerTagAssignment.findAll === 'function') {
        const counts = await CustomerTagAssignment.findAll({
            where: { shop_id: shopId, tag_id: { [Op.in]: rows.map((r) => r.id) } },
            attributes: ['tag_id', [CustomerTagAssignment.sequelize?.fn?.('COUNT', 'tag_id') ?? 'count', 'usage_count']],
            group: ['tag_id'],
            raw: true,
        }).catch(() => []);
        usageBy = new Map((counts || []).map((c) => [String(c.tag_id), Number(c.usage_count) || 0]));
    }
    return { data: rows.map((r) => ({ ...serializeTag(r), usage_count: usageBy.get(String(r.id)) || 0 })) };
}

function normalizeName(raw) {
    const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
    if (!name) fail('Tag name is required', 'TAG_NAME_REQUIRED', 400);
    if (name.length > MAX_TAG_LENGTH) fail(`Tag name exceeds ${MAX_TAG_LENGTH} characters`, 'TAG_NAME_TOO_LONG', 400);
    if (RESERVED.test(name.toLowerCase())) fail('This name is a derived status, not a manual tag', 'TAG_NAME_RESERVED', 400);
    return name;
}

async function createTag({ shopId, name }, actor) {
    const normalized = normalizeName(name);
    await requireActiveMembership(shopId, actor);
    const nameLower = normalized.toLowerCase();
    const existing = await CustomerTag.findOne({ where: { shop_id: shopId, name_lower: nameLower } });
    if (existing) return serializeTag(existing); // idempotent vocabulary
    const count = await CustomerTag.count({ where: { shop_id: shopId } });
    if (count >= MAX_TAGS_PER_SHOP) fail(`Shop tag vocabulary is limited to ${MAX_TAGS_PER_SHOP}`, 'TAG_LIMIT', 409);
    return withTagAuditTransaction(async (transaction) => {
        const created = await CustomerTag.create({
            shop_id: shopId, name: normalized, name_lower: nameLower, created_by: actor.userId || null,
        }, { transaction });
        await audit('CREATE', shopId, actor, { tag_id: created.id, name: normalized }, transaction);
        return serializeTag(created);
    });
}

async function renameTag({ shopId, tagId, name }, actor) {
    if (!privileged(actor)) fail('Only owner/admin can rename the shop tag vocabulary', 'TAG_PRIVILEGE_REQUIRED', 403);
    const normalized = normalizeName(name);
    await requireActiveMembership(shopId, actor);
    return withTagAuditTransaction(async (transaction) => {
        const found = await CustomerTag.findOne({ where: { id: tagId, shop_id: shopId }, transaction });
        if (!found) fail('Tag not found', 'TAG_NOT_FOUND', 404);
        await found.update({ name: normalized, name_lower: normalized.toLowerCase() }, { transaction });
        await audit('UPDATE', shopId, actor, { tag_id: tagId, name: normalized }, transaction);
        return serializeTag(found);
    });
}

async function deleteTag({ shopId, tagId }, actor) {
    if (!privileged(actor)) fail('Only owner/admin can delete vocabulary entries', 'TAG_PRIVILEGE_REQUIRED', 403);
    await requireActiveMembership(shopId, actor);
    return withTagAuditTransaction(async (transaction) => {
        const found = await CustomerTag.findOne({ where: { id: tagId, shop_id: shopId }, transaction });
        if (!found) fail('Tag not found', 'TAG_NOT_FOUND', 404);
        await found.destroy({ transaction }); // cascades assignments
        await audit('DELETE', shopId, actor, { tag_id: tagId, name: found.name }, transaction);
        return { id: tagId, deleted: true };
    });
}

async function listCustomerTags({ shopId, customerId }, actor) {
    await requireActiveMembership(shopId, actor);
    const assignments = await CustomerTagAssignment.findAll({
        where: { shop_id: shopId, customer_id: customerId },
    });
    if (!assignments.length) return { data: [] };
    const defs = await CustomerTag.findAll({
        where: { shop_id: shopId, id: { [Op.in]: assignments.map((a) => a.tag_id) } },
    });
    const byId = new Map(defs.map((d) => [String(d.id), d]));
    return { data: assignments.map((a) => serializeTag(byId.get(String(a.tag_id)))).filter(Boolean) };
}

// Replace-set semantics: the request IS the truth for this customer's tags.
// Idempotent via UNIQUE(tag_id, customer_id); foreign tags are rejected before
// any write; audit carries the resolved id set only.
async function setCustomerTags({ shopId, customerId, tagIds }, actor) {
    await requireActiveMembership(shopId, actor);
    const unique = [...new Set((Array.isArray(tagIds) ? tagIds : []).map(String))];
    if (unique.length > MAX_TAGS_PER_CUSTOMER) fail(`At most ${MAX_TAGS_PER_CUSTOMER} tags per customer`, 'TAG_ASSIGN_LIMIT', 409);

    const customer = await Customer.findOne({ where: { id: customerId, shop_id: shopId }, attributes: ['id'] });
    if (!customer) fail('Customer not found', 'CUSTOMER_NOT_FOUND', 404);

    let defs = [];
    if (unique.length) {
        defs = await CustomerTag.findAll({ where: { shop_id: shopId, id: { [Op.in]: unique } } });
        if (defs.length !== unique.length) fail('One or more tags do not belong to this shop', 'TAG_NOT_FOUND', 404);
    }

    // Atomic replace-set: a failure between clear and insert must not silently
    // wipe the customer's tags. Falls back to un-transacted only when the model
    // exposes no transaction (unit-mock path).
    return withTagAuditTransaction(async (tx) => {
        const opts = tx ? { transaction: tx } : {};
        await CustomerTagAssignment.destroy({ where: { shop_id: shopId, customer_id: customerId }, ...opts });
        if (defs.length) {
            await CustomerTagAssignment.bulkCreate(
                defs.map((d) => ({ shop_id: shopId, tag_id: d.id, customer_id: customerId, created_by: actor.userId || null })),
                { ignoreDuplicates: true, ...opts },
            );
        }
        await audit('UPDATE', shopId, actor, { customer_id: customerId, tag_ids: defs.map((d) => d.id) }, tx);
        return { data: defs.map(serializeTag) };
    });
}

module.exports = {
    listTags, createTag, renameTag, deleteTag, listCustomerTags, setCustomerTags,
    MAX_TAGS_PER_SHOP, MAX_TAGS_PER_CUSTOMER, RESERVED,
};
