'use strict';

const { createLogger } = require('../../utils/structured-logger');
const { AppError } = require('../../utils/AppError');
const { Op } = require('sequelize');
const { CustomerNote, Customer, UserShop, AuditLog } = require('../entities');

const logger = createLogger('customer-notes');

const MAX_BODY = 2000;
const MAX_PAGE = 100;

const fail = (message, code, statusCode) => {
    const error = new AppError(message, statusCode);
    error.code = code;
    // AppError exposes .status; controllers/handlers in this repo read
    // .statusCode — set both so the declared class survives every path.
    error.statusCode = statusCode;
    throw error;
};

// MW-V1 CRM Lite — staff-private customer notes (doc 05).
// Hard rules pinned here: every query carries shop_id; bodies never enter
// audit payloads or logs; author + privileged-only mutation; soft delete.
const serialize = (note) => ({
    id: note.id,
    shop_id: note.shop_id,
    customer_id: note.customer_id,
    body: note.body,
    author_id: note.author_id,
    author_name: note.author_name || null,
    created_at: note.created_at ?? note.createdAt ?? null,
    updated_at: note.updated_at ?? note.updatedAt ?? null,
});

const audit = (action, shopId, actor, note, extra = {}) => {
    if (typeof AuditLog?.create !== 'function') return;
    AuditLog.create({
        user_id: actor?.userId || null,
        shop_id: shopId,
        action,
        resource_type: 'customer_note',
        resource_id: note?.id || null,
        metadata: {
            customer_id: note?.customer_id || null,
            // Content discipline: length only, NEVER the body text.
            body_length: typeof note?.body === 'string' ? note.body.length : null,
            ...extra,
        },
    }).catch((error) => logger.warn('customer_note audit write failed', { error: error.message }));
};

const requireBody = (raw) => {
    const body = typeof raw === 'string' ? raw.trim() : '';
    if (!body) fail('Note body is required', 'NOTE_BODY_REQUIRED', 400);
    if (body.length > MAX_BODY) fail(`Note body exceeds ${MAX_BODY} characters`, 'NOTE_TOO_LONG', 400);
    return body;
};

async function requireActiveMembership(shopId, actor) {
    if (typeof UserShop?.findOne !== 'function') {
        fail('Membership check unavailable', 'MEMBERSHIP_CHECK_UNAVAILABLE', 503);
    }
    const member = await UserShop.findOne({
        where: { user_id: actor.userId, shop_id: shopId, is_active: true },
    });
    if (!member) fail('You do not have access to this shop', 'FORBIDDEN', 403);
}

async function createNote({ shopId, customerId, body }, actor) {
    const trimmed = requireBody(body);
    await requireActiveMembership(shopId, actor);
    const customer = typeof Customer?.findOne === 'function'
        ? await Customer.findOne({ where: { id: customerId, shop_id: shopId }, attributes: ['id'] })
        : null;
    if (!customer) fail('Customer not found', 'CUSTOMER_NOT_FOUND', 404);

    const created = await CustomerNote.create({
        shop_id: shopId,
        customer_id: customerId,
        body: trimmed,
        author_id: actor.userId || null,
        author_name: actor.name || actor.email || 'Team member',
    });
    audit('CREATE', shopId, actor, created);
    return serialize(created);
}

async function listNotes({ shopId, customerId, limit, before }, actor) {
    await requireActiveMembership(shopId, actor);
    const boundedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), MAX_PAGE);
    const where = { shop_id: shopId, customer_id: customerId, deletedAt: null };
    if (before) {
        const beforeDate = new Date(before);
        if (!Number.isNaN(beforeDate.getTime())) {
            where.created_at = { [Op.lt]: beforeDate };
        }
    }
    const [rows, total] = await Promise.all([
        CustomerNote.findAll({ where, order: [['created_at', 'DESC']], limit: boundedLimit }),
        CustomerNote.count({ where }),
    ]);
    return { data: (rows || []).map(serialize), total: total || 0 };
}

async function loadOwnedNote(shopId, noteId) {
    const found = await CustomerNote.findOne({ where: { id: noteId, shop_id: shopId } });
    if (!found) fail('Note not found', 'NOTE_NOT_FOUND', 404);
    return found;
}

const privileged = (actor) => ['owner', 'admin'].includes(String(actor?.role || '').toLowerCase());

async function updateNote({ shopId, noteId, body }, actor) {
    const trimmed = requireBody(body);
    await requireActiveMembership(shopId, actor);
    const existing = await loadOwnedNote(shopId, noteId);
    if (String(existing.author_id) !== String(actor.userId) && !privileged(actor)) {
        fail('Only the note author (or an owner/admin) can edit a note', 'NOTE_NOT_AUTHOR', 403);
    }
    const previousLength = existing.body?.length || 0;
    await existing.update({ body: trimmed });
    audit('UPDATE', shopId, actor, existing, { previous_length: previousLength });
    return serialize(existing);
}

async function deleteNote({ shopId, noteId }, actor) {
    await requireActiveMembership(shopId, actor);
    const existing = await loadOwnedNote(shopId, noteId);
    if (String(existing.author_id) !== String(actor.userId) && !privileged(actor)) {
        fail('Only the note author (or an owner/admin) can delete a note', 'NOTE_NOT_AUTHOR', 403);
    }
    await existing.destroy(); // paranoid: soft delete, retention-visible
    audit('DELETE', shopId, actor, existing);
    return { id: existing.id, deleted: true };
}

module.exports = { createNote, listNotes, updateNote, deleteNote, serialize, MAX_BODY };
