'use strict';

/**
 * MW-V1 Increment 2 real-stack integration (REAL PostgreSQL; no service mocks):
 *  - ownership D1-D4 semantics over HTTP (force reachable, membership enforced,
 *    assignee visible in reads, server-side audit written)
 *  - verified customer_id associations (conversations + orders) incl. same-name
 *    customers staying distinct
 *  - notes lifecycle with author scoping + content-free audit rows
 *  - tag vocabulary bounds, reserved names, idempotent set assignment
 *  - action-queue server counts + view filtering
 */

const request = require('supertest');
const { createFixtures } = require('../../../../tests/helpers/pilot-intelligence.fixtures');
const {
    ShopPilotFeatures, Conversation: ConversationModel, AuditLog,
    CustomerNote, CustomerTag, CustomerTagAssignment,
} = require('../../entities');
const conversationService = require('../../conversation/conversation.service');

const app = require('../../../app');

const fx = createFixtures('MW-V1 Increment 2');
const auth = (user, shopId) => ({ Authorization: `Bearer ${fx.tokenFor(user, shopId)}` });

const enableQueue = async (shopId) => {
    await ShopPilotFeatures.update({ action_queue: true }, { where: { shop_id: shopId } });
};

afterAll(async () => { await fx.cleanup(); });

const seedConversation = async (shop, customer, overrides = {}) => {
    const conversation = await fx.makeConversation(shop, customer, overrides);
    return conversation;
};

describe('ownership over HTTP (D1-D4)', () => {
    let shop, owner, staffA, staffB, outsider, customer, conversation;

    beforeEach(async () => {
        shop = await fx.makeShop();
        owner = await fx.makeMember(shop, 'owner');
        staffA = await fx.makeMember(shop, 'staff');
        staffB = await fx.makeMember(shop, 'staff');
        const otherShop = await fx.makeShop();
        outsider = await fx.makeMember(otherShop, 'staff');
        customer = await fx.makeCustomer(shop, { name: 'Same Name' });
        conversation = await seedConversation(shop, customer, { hitl: true });
    });

    it('D2: foreign-shop assignee id is rejected 400 INVALID_ASSIGNEE', async () => {
        const res = await request(app)
            .patch(`/api/conversation/${conversation.id}`)
            .set(auth(owner, shop.id))
            .send({ assignee_id: outsider.id });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_ASSIGNEE');
        await conversation.reload();
        expect(conversation.assignee_id).toBeNull();
    });

    it('D1+claim: staff claim assigns; second staff gets 409; owner force succeeds; audit written', async () => {
        const claimA = await request(app)
            .patch(`/api/conversation/${conversation.id}`)
            .set(auth(staffA, shop.id))
            .send({ hitl: true });
        expect(claimA.status).toBe(200);
        expect(claimA.body.data.assignee_id).toBe(staffA.id);
        expect(claimA.body.data.assignee).toMatchObject({ id: staffA.id });

        const clashB = await request(app)
            .patch(`/api/conversation/${conversation.id}`)
            .set(auth(staffB, shop.id))
            .send({ hitl: true });
        expect(clashB.status).toBe(409);

        const forceOwner = await request(app)
            .patch(`/api/conversation/${conversation.id}`)
            .set(auth(owner, shop.id))
            .send({ hitl: true, force: true });
        expect(forceOwner.status).toBe(200);
        expect(forceOwner.body.data.assignee_id).toBe(owner.id);

        const audits = await AuditLog.findAll({
            where: { shop_id: shop.id, resource_type: 'conversation_ownership' },
        });
        expect(audits.length).toBeGreaterThanOrEqual(2);
        const forced = audits.map((a) => a.metadata).find((m) => m && m.forced === true);
        expect(forced).toBeTruthy();
        expect(forced.to.assignee_id).toBe(owner.id);
        expect(forced.from.assignee_id).toBe(staffA.id);
    });

    it('staff force is INERT — no self-escalation over another owner', async () => {
        await conversationService.updateConversation(conversation.id, shop.id,
            { hitl: true }, { actor: { userId: staffA.id, role: 'staff' } });
        const res = await request(app)
            .patch(`/api/conversation/${conversation.id}`)
            .set(auth(staffB, shop.id))
            .send({ hitl: true, force: true });
        expect(res.status).toBe(409);
    });

    it('D3: list reads expose assignee_id and a batched assignee name', async () => {
        await conversationService.updateConversation(conversation.id, shop.id,
            { assignee_id: staffA.id }, { actor: { userId: owner.id, role: 'owner' } });

        const res = await request(app)
            .get('/api/conversation')
            .set(auth(owner, shop.id));
        expect(res.status).toBe(200);
        const row = res.body.data.conversations.find((c) => c.id === conversation.id);
        expect(row.assignee_id).toBe(staffA.id);
        expect(row.assignee.name).toBe(`${'MW-V1 Increment 2'} staff`);
    });
});

describe('verified customer_id associations', () => {
    it('same-name customers never cross-associate in conversations or orders', async () => {
        const shop = await fx.makeShop();
        const owner = await fx.makeMember(shop, 'owner');
        const a = await fx.makeCustomer(shop, { name: 'Rahim Uddin' });
        const b = await fx.makeCustomer(shop, { name: 'Rahim Uddin' });
        const convA = await seedConversation(shop, a);
        const convB = await seedConversation(shop, b);
        await fx.makeOrder(shop, { customer_id: a.id, customer_name: 'Rahim Uddin' });
        await fx.makeOrder(shop, { customer_id: b.id, customer_name: 'Rahim Uddin' });

        const convRes = await request(app)
            .get(`/api/conversation?customer_id=${b.id}`)
            .set(auth(owner, shop.id));
        const ids = convRes.body.data.conversations.map((c) => c.id);
        expect(ids).toEqual([convB.id]);
        expect(ids).not.toContain(convA.id);

        const orderRes = await request(app)
            .get(`/api/order?customer_id=${b.id}`)
            .set(auth(owner, shop.id));
        expect(orderRes.status).toBe(200);
        const rows = orderRes.body.data ?? orderRes.body.data?.orders ?? [];
        expect(rows.every((o) => String(o.customer_id) === String(b.id))).toBe(true);
        expect(rows.length).toBe(1);
    });

    it('non-uuid customer_id is rejected by the order validator', async () => {
        const shop = await fx.makeShop();
        const owner = await fx.makeMember(shop, 'owner');
        const res = await request(app)
            .get('/api/order?customer_id=Rahim%20Uddin')
            .set(auth(owner, shop.id));
        expect(res.status).toBe(400);
    });
});

describe('notes lifecycle (real rows + content-free audit)', () => {
    let shop, owner, staffOther, customer;

    beforeEach(async () => {
        shop = await fx.makeShop();
        owner = await fx.makeMember(shop, 'owner');
        staffOther = await fx.makeMember(shop, 'staff');
        customer = await fx.makeCustomer(shop);
    });

    const author = () => fx.makeMember(shop, 'staff');

    it('create/list/edit/delete with author scope; cross-shop invisible; audits carry no body', async () => {
        const writer = await author();
        const created = await request(app)
            .post(`/api/customer/${customer.id}/notes`)
            .set(auth(writer, shop.id))
            .send({ body: '  prefers morning courier calls  ' });
        expect(created.status).toBe(201);
        expect(created.body.data.body).toBe('prefers morning courier calls');
        const noteId = created.body.data.id;

        const list = await request(app)
            .get(`/api/customer/${customer.id}/notes`)
            .set(auth(writer, shop.id));
        expect(list.body.data.data).toHaveLength(1);

        const foreignShop = await fx.makeShop();
        const foreignOwner = await fx.makeMember(foreignShop, 'owner');
        const foreign = await request(app)
            .get(`/api/customer/${customer.id}/notes`)
            .set(auth(foreignOwner, shop.id)); // token names a shop the user is NOT a member of
        // foreign requester cannot act in this shop's scope: 403 (membership) — never the note
        expect([403, 404]).toContain(foreign.status);

        const strangerEdit = await request(app)
            .patch(`/api/customer/${customer.id}/notes/${noteId}`)
            .set(auth(staffOther, shop.id))
            .send({ body: 'tampered' });
        expect(strangerEdit.status).toBe(403);

        const ownerFix = await request(app)
            .patch(`/api/customer/${customer.id}/notes/${noteId}`)
            .set(auth(owner, shop.id))
            .send({ body: 'corrected wording' });
        expect(ownerFix.status).toBe(200);
        expect(ownerFix.body.data.body).toBe('corrected wording');

        const del = await request(app)
            .delete(`/api/customer/${customer.id}/notes/${noteId}`)
            .set(auth(writer, shop.id));
        expect(del.status).toBe(200);
        const after = await request(app)
            .get(`/api/customer/${customer.id}/notes`)
            .set(auth(writer, shop.id));
        expect(after.body.data.data).toHaveLength(0);
        const row = await CustomerNote.findByPk(noteId, { paranoid: false });
        expect(row).not.toBeNull();
        expect(row.deletedAt).toBeTruthy(); // soft, retention-visible

        const audits = await AuditLog.findAll({ where: { shop_id: shop.id, resource_type: 'customer_note' } });
        expect(audits.length).toBeGreaterThanOrEqual(3);
        const serialized = audits.map((a) => JSON.stringify(a.toJSON())).join('|');
        expect(serialized).not.toMatch(/courier calls|corrected wording/);
        expect(JSON.stringify(audits[0].toJSON())).toMatch(/body_length/);
    });

    it('empty/blank note body is rejected; oversized body is rejected', async () => {
        const writer = await author();
        const blank = await request(app)
            .post(`/api/customer/${customer.id}/notes`)
            .set(auth(writer, shop.id))
            .send({ body: '   ' });
        expect(blank.status).toBeGreaterThanOrEqual(400);
        expect(blank.status).toBeLessThan(500);
        const big = await request(app)
            .post(`/api/customer/${customer.id}/notes`)
            .set(auth(writer, shop.id))
            .send({ body: 'x'.repeat(2001) });
        expect(big.status).toBe(400);
    });

    // F5: the ?before= cursor is real-Postgres tested (not just mock-verified).
    it('paginates older notes with the before cursor', async () => {
        const { sequelize } = require('../../../utils/database/database-setup');
        const writer = await author();
        const n1 = await CustomerNote.create({ shop_id: shop.id, customer_id: customer.id, body: 'older note', author_id: writer.id, author_name: 'W' });
        const n2 = await CustomerNote.create({ shop_id: shop.id, customer_id: customer.id, body: 'newer note', author_id: writer.id, author_name: 'W' });
        const old = new Date(Date.now() - 5 * 86400_000).toISOString();
        const recent = new Date(Date.now() - 86400_000).toISOString();
        await sequelize.query('UPDATE customer_notes SET created_at = :at WHERE id = :id', { replacements: { at: old, id: n1.id } });
        await sequelize.query('UPDATE customer_notes SET created_at = :at WHERE id = :id', { replacements: { at: recent, id: n2.id } });

        const all = await request(app).get(`/api/customer/${customer.id}/notes`).set(auth(writer, shop.id));
        expect(all.body.data.total).toBe(2);
        expect(all.body.data.data[0].body).toBe('newer note'); // newest first

        const before = await request(app)
            .get(`/api/customer/${customer.id}/notes?before=${encodeURIComponent(recent)}`)
            .set(auth(writer, shop.id));
        expect(before.status).toBe(200);
        const bodies = before.body.data.data.map((n) => n.body);
        expect(bodies).toEqual(['older note']); // strictly older than the cursor
    });
});

describe('tag vocabulary + assignments', () => {
    let shop, owner, staffUser, customer, tag;

    beforeEach(async () => {
        shop = await fx.makeShop();
        owner = await fx.makeMember(shop, 'owner');
        staffUser = await fx.makeMember(shop, 'staff');
        customer = await fx.makeCustomer(shop);
        const created = await request(app)
            .post('/api/customer/tags')
            .set(auth(owner, shop.id))
            .send({ name: 'Wholesale inquiry' });
        tag = created.body.data;
    });

    it('case-insensitive dedupe is idempotent and shop-scoped', async () => {
        const again = await request(app)
            .post('/api/customer/tags')
            .set(auth(owner, shop.id))
            .send({ name: '  wholesale   INQUIRY ' });
        expect(again.status).toBe(201);
        expect(again.body.data.id).toBe(tag.id);
    });

    it('reserved derived-status names are rejected', async () => {
        const res = await request(app)
            .post('/api/customer/tags')
            .set(auth(owner, shop.id))
            .send({ name: 'Repeat Buyer' });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('TAG_NAME_RESERVED');
    });

    it('staff cannot rename vocabulary; owner can', async () => {
        const denied = await request(app)
            .patch(`/api/customer/tags/${tag.id}`)
            .set(auth(staffUser, shop.id))
            .send({ name: 'Renamed' });
        expect(denied.status).toBe(403);
        const ok = await request(app)
            .patch(`/api/customer/tags/${tag.id}`)
            .set(auth(owner, shop.id))
            .send({ name: 'Renamed' });
        expect(ok.status).toBe(200);
    });

    it('set assign is idempotent (dupes collapse), rejects foreign tags, and persists', async () => {
        const assigned = await request(app)
            .put(`/api/customer/${customer.id}/tags`)
            .set(auth(staffUser, shop.id))
            .send({ tag_ids: [tag.id, tag.id] });
        expect(assigned.status).toBe(200);
        expect(assigned.body.data.data).toHaveLength(1);

        const foreignShop = await fx.makeShop();
        const foreignOwner = await fx.makeMember(foreignShop, 'owner');
        const foreignTag = await request(app)
            .post('/api/customer/tags')
            .set(auth(foreignOwner, foreignShop.id))
            .send({ name: 'Elsewhere' });
        const smuggle = await request(app)
            .put(`/api/customer/${customer.id}/tags`)
            .set(auth(staffUser, shop.id))
            .send({ tag_ids: [foreignTag.body.data.id] });
        expect(smuggle.status).toBe(404);

        const list = await request(app)
            .get(`/api/customer/${customer.id}/tags`)
            .set(auth(staffUser, shop.id));
        expect(list.body.data.data.map((t) => t.id)).toEqual([tag.id]);
        const rows = await CustomerTagAssignment.findAll({ where: { customer_id: customer.id } });
        expect(rows).toHaveLength(1);
    });
});

// ─── IC-V1: v6 contract port over real HTTP (review F2) ─────────────────────
describe('draft courier-booking rejection over HTTP', () => {
    it('409 DRAFT_ORDER_NOT_BOOKABLE and the draft is left completely unmutated', async () => {
        const shop = await fx.makeShop();
        const owner = await fx.makeMember(shop, 'owner');
        const order = await fx.makeOrder(shop, {
            order_status: 'draft',
            customer_name: 'Draft Proof',
            customer_phone: '01710000009',
            delivery_address: 'House 9 Test Road Dhaka',
        });

        const res = await request(app)
            .post(`/api/order/${order.id}/book-courier`)
            .set(auth(owner, shop.id))
            .send({});
        expect(res.status).toBe(409);
        expect(res.body.error).toMatchObject({ code: 'DRAFT_ORDER_NOT_BOOKABLE' });

        await order.reload();
        expect(order.order_status).toBe('draft');
        // F1 guarantee at the transport level: no setup/hold marking, no notification side effect
        expect(String(order.delivery_status || '')).not.toMatch(/setup_required|confidence_hold/);
    });
});

describe('action queue server counts + views', () => {
    it('counts and views come from the server, not the page', async () => {
        const shop = await fx.makeShop();
        const owner = await fx.makeMember(shop, 'owner');
        const staff = await fx.makeMember(shop, 'staff');
        await enableQueue(shop.id);
        const c1 = await fx.makeCustomer(shop, { name: 'One' });
        const c2 = await fx.makeCustomer(shop, { name: 'Two' });
        const conv1 = await seedConversation(shop, c1, { hitl: true });
        const conv2 = await seedConversation(shop, c2, { hitl: true });
        await conversationService.updateConversation(conv2.id, shop.id,
            { assignee_id: staff.id }, { actor: { userId: owner.id, role: 'owner' } });

        const all = await request(app).get('/api/inbox/actions').set(auth(owner, shop.id));
        expect(all.status).toBe(200);
        expect(all.body.data.counts.total).toBe(2);
        expect(all.body.data.counts.by_bucket['1']).toBe(2);
        expect(all.body.data.counts.views.unassigned).toBe(1);
        expect(all.body.data.counts.views.handoff).toBe(2);
        expect(all.body.data.counts.views.mine).toBe(0);

        const unassigned = await request(app)
            .get('/api/inbox/actions?view=unassigned')
            .set(auth(owner, shop.id));
        expect(unassigned.body.data.items).toHaveLength(1);
        expect(unassigned.body.data.items[0].conversation_id).toBe(conv1.id);

        const mine = await request(app)
            .get('/api/inbox/actions?view=mine')
            .set(auth(staff, shop.id));
        expect(mine.body.data.items).toHaveLength(1);
        expect(mine.body.data.items[0].owner).toBe(staff.id);

        const bogus = await request(app)
            .get('/api/inbox/actions?view=not_a_view')
            .set(auth(owner, shop.id));
        expect(bogus.body.data.items).toHaveLength(2); // falls back to attention
    });
});
