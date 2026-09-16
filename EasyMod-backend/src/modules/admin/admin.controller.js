'use strict';

const adminService = require('./admin.service');
const AuditService = require('../audit/audit.service');
const { AppError } = require('../../utils/AppError');

const ok = (res, data) => res.json({ success: true, data });

function auditCtx(req) {
  return { ipAddress: req.ip, userAgent: req.get('user-agent') || null };
}

// ── Reads ──────────────────────────────────────────────────────────────────
exports.getDashboard = async (req, res, next) => {
  try { ok(res, await adminService.getDashboard()); } catch (e) { next(e); }
};
exports.getMetaIdentityReadiness = async (req, res, next) => {
  try { ok(res, await adminService.getMetaIdentityReadiness()); } catch (e) { next(e); }
};
exports.getStalePaymentProcessing = async (req, res, next) => {
  try {
    const reconciliationService = require('../payment/payment-processing-reconciliation.service');
    ok(res, await reconciliationService.getStalePaymentProcessingReport({
      olderThanMinutes: req.query.olderThanMinutes,
      limit: req.query.limit,
    }));
  } catch (e) { next(e); }
};
exports.listShops = async (req, res, next) => {
  try { ok(res, await adminService.listShops(req.query)); } catch (e) { next(e); }
};
exports.getShopOverview = async (req, res, next) => {
  try { ok(res, await adminService.getShopOverview(req.params.shopId)); } catch (e) { next(e); }
};
exports.getShopChannels = async (req, res, next) => {
  try { ok(res, await adminService.getShopChannels(req.params.shopId)); } catch (e) { next(e); }
};
exports.getShopBilling = async (req, res, next) => {
  try { ok(res, await adminService.getShopBilling(req.params.shopId)); } catch (e) { next(e); }
};
exports.getAuditLogs = async (req, res, next) => {
  try { ok(res, await adminService.getAuditLogs(req.query)); } catch (e) { next(e); }
};

// ── Mutations (audited) ──────────────────────────────────────────────────────
exports.setShopStatus = async (req, res, next) => {
  try {
    const { shopId } = req.params;
    const { status } = req.body;
    const { sequelize } = require('../../utils/database/database-setup');
    const after = await sequelize.transaction(async (transaction) => {
      const { before, after: next } = await adminService.setShopStatus(shopId, status, { transaction });
      await AuditService.logOperation({
        userId: req.user.userId, shopId,
        action: status === 'suspended' ? 'admin:suspend_shop' : 'admin:reactivate_shop',
        resourceType: 'SUBSCRIPTION', resourceId: shopId,
        oldValues: before, newValues: next, ...auditCtx(req),
      }, { transaction, required: true });
      return next;
    });
    ok(res, after);
  } catch (e) { next(e); }
};

exports.addCredits = async (req, res, next) => {
  try {
    const { shopId } = req.params;
    const idempotencyKey = req.get('Idempotency-Key');
    if (!idempotencyKey) throw new AppError('Idempotency-Key header is required for credit grants.', 400, 'ADMIN_IDEMPOTENCY_REQUIRED');
    const { sequelize } = require('../../utils/database/database-setup');
    const after = await sequelize.transaction(async (transaction) => {
      const { before, after: next } = await adminService.addCredits(shopId, req.body.amount, req.body.reason, {
        idempotencyKey,
        actorUserId: req.user.userId,
        transaction,
      });
      await AuditService.logOperation({
        userId: req.user.userId, shopId, action: 'admin:add_credits',
        resourceType: 'SUBSCRIPTION', resourceId: shopId,
        oldValues: before, newValues: next, ...auditCtx(req),
      }, { transaction, required: true });
      return next;
    });
    ok(res, after);
  } catch (e) { next(e); }
};

exports.changePlan = async (req, res, next) => {
  try {
    const { shopId } = req.params;
    const { sequelize } = require('../../utils/database/database-setup');
    const after = await sequelize.transaction(async (transaction) => {
      const { before, after: next } = await adminService.changePlan(
        shopId,
        req.user.userId,
        req.body,
        { transaction },
      );
      await AuditService.logOperation({
        userId: req.user.userId, shopId, action: 'admin:change_plan',
        resourceType: 'SUBSCRIPTION', resourceId: shopId,
        oldValues: before, newValues: next, ...auditCtx(req),
      }, { transaction, required: true });
      return next;
    });
    ok(res, after);
  } catch (e) { next(e); }
};

exports.markChannelReconnect = async (req, res, next) => {
  try {
    const { shopId, channelId } = req.params;
    const { sequelize } = require('../../utils/database/database-setup');
    const after = await sequelize.transaction(async (transaction) => {
      const { before, after: next } = await adminService.markChannelReconnect(shopId, channelId, { transaction });
      await AuditService.logOperation({
        userId: req.user.userId, shopId, action: 'admin:mark_reconnect',
        resourceType: 'META_CHANNEL', resourceId: channelId,
        oldValues: before, newValues: next, ...auditCtx(req),
      }, { transaction, required: true });
      return next;
    });
    ok(res, after);
  } catch (e) { next(e); }
};

exports.emergencyDisableAi = async (req, res, next) => {
  try {
    const { shopId } = req.params;
    const { sequelize } = require('../../utils/database/database-setup');
    const after = await sequelize.transaction(async (transaction) => {
      const { before, after: next } = await adminService.emergencyDisableAi(
        shopId,
        req.user.userId,
        { transaction },
      );
      await AuditService.logOperation({
        userId: req.user.userId, shopId, action: 'admin:emergency_ai_off',
        resourceType: 'SHOP', resourceId: shopId,
        oldValues: before, newValues: next, ...auditCtx(req),
      }, { transaction, required: true });
      return next;
    });
    ok(res, after);
  } catch (e) { next(e); }
};

// ── Ops alerting self-test (finding F-06) ────────────────────────────────────
// Fires a deliberate, PII-free alert so an operator can confirm a real human
// receives it. Reports which sinks are configured and whether each accepted the
// event. Configuration alone does NOT close launch gate 8 — a person must still
// confirm receipt on a device they watch.
exports.sendTestAlert = async (req, res, next) => {
  try {
    await AuditService.logOperation({
      userId: req.user.userId, shopId: null, action: 'admin:ops_test_alert',
      resourceType: 'OPS', resourceId: null,
      oldValues: null, newValues: { status: 'requested' }, ...auditCtx(req),
    }, { required: true });
    const { sendTestAlert } = require('../../utils/ops-alert');
    const result = await sendTestAlert({ actorLabel: `admin:${req.user.userId}` });
    ok(res, {
      ...result,
      note: result.anySinkConfigured
        ? 'Alert dispatched. Confirm a human received it before treating alerting as verified.'
        : 'No alert sink is configured (SENTRY_DSN / SLACK_ALERT_WEBHOOK_URL). Alerting reaches no one.',
    });
  } catch (e) { next(e); }
};
