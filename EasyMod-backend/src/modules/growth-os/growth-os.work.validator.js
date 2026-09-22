'use strict';

const Joi = require('joi');

const uuid = () => Joi.string().uuid();
const isoDate = () => Joi.date().iso();
const boundedText = (min, max) => Joi.string().trim().min(min).max(max);
const reason = (max = 200) => boundedText(1, max).required();
const page = () => Joi.number().integer().min(1).default(1);
const pageSize = (max = 100) => Joi.number().integer().min(1).max(max).default(20);

const CANONICAL_ROLES = ['SUPER_ADMIN', 'GROWTH_USER'];
const NOTE_TARGETS = ['prospect', 'user', 'shop'];
const FOLLOWUP_STATES = ['open', 'completed', 'cancelled', 'overdue', 'due_today', 'all'];
const AUDIT_RESOURCES = [
  'GROWTH_OS_ROLE',
  'GROWTH_OS_USER_ADMIN',
  'growth_os_prospect',
  'GROWTH_OS_ADMIN_MERCHANT',
];

const followups = {
  create: {
    body: Joi.object({
      prospectId: uuid().required(),
      ownerUserId: uuid().optional(),
      dueAt: isoDate().required(),
      action: boundedText(1, 200).required(),
      note: Joi.string().trim().max(2000).optional().allow(null, ''),
    }).unknown(false),
  },
  list: {
    query: Joi.object({
      prospectId: uuid().optional(),
      state: Joi.string().valid(...FOLLOWUP_STATES).default('open'),
      owner: Joi.string().valid('me').optional(),
      page: page().optional(),
      pageSize: pageSize(100).optional(),
    }),
  },
  update: {
    params: Joi.object({ id: uuid().required() }),
    body: Joi.object({
      ownerUserId: uuid().optional(),
      dueAt: isoDate().optional(),
      action: boundedText(1, 200).optional(),
      note: Joi.string().trim().max(2000).optional().allow(null),
    }).min(1).unknown(false),
  },
  transition: {
    params: Joi.object({ id: uuid().required() }),
    body: Joi.object({
      status: Joi.string().valid('completed', 'cancelled').required(),
    }).unknown(false),
  },
};

const notes = {
  create: {
    body: Joi.object({
      targetType: Joi.string().valid(...NOTE_TARGETS).required(),
      targetId: uuid().required(),
      body: boundedText(1, 4000).required(),
    }).unknown(false),
  },
  list: {
    query: Joi.object({
      targetType: Joi.string().valid(...NOTE_TARGETS).required(),
      targetId: uuid().required(),
      page: page().optional(),
      pageSize: pageSize(100).optional(),
    }),
  },
  delete: {
    params: Joi.object({ id: uuid().required() }),
  },
};

const workspace = {
  analytics: {
    query: Joi.object({ window: Joi.number().integer().min(7).max(365).default(90) }),
  },
  search: {
    query: Joi.object({
      q: Joi.string().trim().min(2).max(100).required(),
    }),
  },
};

const usersAdmin = {
  list: {
    query: Joi.object({}).unknown(false),
  },
  search: {
    body: Joi.object({ search: boundedText(0, 120).allow('').default('') }).unknown(false),
  },
  create: {
    body: Joi.object({
      email: Joi.string().trim().email({ tlds: { allow: false } }).max(255).required(),
      fullName: boundedText(1, 255).required(),
      role: Joi.string().valid(...CANONICAL_ROLES).required(),
      reason: reason(),
    }).unknown(false),
  },
  status: {
    params: Joi.object({ userId: uuid().required() }),
    body: Joi.object({
      active: Joi.boolean().required(),
      reason: reason(),
    }).unknown(false),
  },
  role: {
    params: Joi.object({ userId: uuid().required() }),
    body: Joi.object({
      role: Joi.string().valid(...CANONICAL_ROLES).required(),
      reason: reason(),
    }).unknown(false),
  },
  reasonOnly: {
    params: Joi.object({ userId: uuid().required() }),
    body: Joi.object({ reason: reason() }).unknown(false),
  },
};

const merchantsAdmin = {
  list: {
    query: Joi.object({
      search: boundedText(0, 120).allow('').default(''),
      page: page().optional(),
      pageSize: pageSize(50).optional(),
    }),
  },
  shopId: {
    params: Joi.object({ shopId: uuid().required() }),
  },
  status: {
    params: Joi.object({ shopId: uuid().required() }),
    body: Joi.object({
      active: Joi.boolean().required(),
      reason: reason(300),
    }).unknown(false),
  },
  credits: {
    params: Joi.object({ shopId: uuid().required() }),
    body: Joi.object({
      amount: Joi.number().integer().min(1).max(100000).required(),
      reason: reason(300),
    }).unknown(false),
  },
  channelReconnect: {
    params: Joi.object({ shopId: uuid().required(), channelId: uuid().required() }),
    body: Joi.object({ reason: reason(300), confirm: Joi.string().valid('RECONNECT').required() })
      .unknown(false),
  },
  operations: {
    query: Joi.object({ window: Joi.number().integer().min(1).max(90).default(7) }),
  },
  auditList: {
    query: Joi.object({
      search: boundedText(0, 60).allow('').default(''),
      resourceType: Joi.string().valid(...AUDIT_RESOURCES).optional().allow(''),
      page: page().optional(),
      pageSize: pageSize(100).optional(),
    }),
  },
};

module.exports = {
  followups,
  notes,
  workspace,
  usersAdmin,
  merchantsAdmin,
};
