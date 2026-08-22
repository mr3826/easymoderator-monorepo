'use strict';

const Joi = require('joi');
const { PROSPECT_SOURCES, PROSPECT_STATUSES } = require('./growth-os.prospect.lifecycle');

const uuid = Joi.string().uuid();
const text = (max) => Joi.string().trim().max(max).allow('', null);
const requiredText = (max) => Joi.string().trim().min(1).max(max).required();
const email = Joi.string().trim().email({ tlds: { allow: false } }).max(255).allow('', null);
const channelKeys = ['contactPhone', 'contactEmail', 'pageUrl', 'contact_phone', 'contact_email', 'page_url'];

const prospectFields = {
  businessName: Joi.string().trim().max(255),
  business_name: Joi.string().trim().max(255),
  contactName: text(255),
  contact_name: text(255),
  contactPhone: text(32),
  contact_phone: text(32),
  contactEmail: email,
  contact_email: email,
  pageUrl: text(2048),
  page_url: text(2048),
  niche: text(120),
  notes: text(10000),
  source: Joi.string().valid(...PROSPECT_SOURCES),
  sourceDetail: text(160),
  source_detail: text(160),
  sourceReference: text(255),
  source_reference: text(255),
  metadata: Joi.object().max(50),
};

const idParams = {
  params: Joi.object({ id: uuid.required() }),
  query: Joi.object({
    timelinePage: Joi.number().integer().min(1).default(1),
    timelinePageSize: Joi.number().integer().min(1).max(100).default(20),
  }),
};

const createProspect = {
  body: Joi.object({
    ...prospectFields,
    businessName: Joi.string().trim().max(255),
    business_name: Joi.string().trim().max(255),
    source: Joi.string().valid(...PROSPECT_SOURCES).required(),
  }).or('businessName', 'business_name').or(...channelKeys),
};

const updateProspect = {
  ...idParams,
  body: Joi.object(prospectFields).min(1),
};

const listProspects = {
  query: Joi.object({
    status: Joi.string().valid(...PROSPECT_STATUSES),
    source: Joi.string().valid(...PROSPECT_SOURCES),
    ownerUserId: uuid,
    owner_user_id: uuid,
    q: Joi.string().trim().max(200),
    linked: Joi.boolean().truthy('true').falsy('false'),
    page: Joi.number().integer().min(1).default(1),
    pageSize: Joi.number().integer().min(1).max(100).default(20),
  }),
};

const duplicateCheck = {
  query: Joi.object({
    ...prospectFields,
    excludeId: uuid,
    exclude_id: uuid,
  }).or(...channelKeys),
};

const assignProspect = {
  ...idParams,
  body: Joi.object({
    ownerUserId: uuid.allow(null),
    owner_user_id: uuid.allow(null),
    reason: requiredText(200),
  }).or('ownerUserId', 'owner_user_id'),
};

const transitionProspect = {
  ...idParams,
  body: Joi.object({
    status: Joi.string().valid(...PROSPECT_STATUSES).required(),
    reason: text(200),
  }),
};

const linkProspect = {
  ...idParams,
  body: Joi.object({
    shopId: uuid.allow(null),
    shop_id: uuid.allow(null),
    userId: uuid.allow(null),
    user_id: uuid.allow(null),
    reason: requiredText(200),
  }).or('shopId', 'shop_id', 'userId', 'user_id'),
};

const linkageSuggestions = idParams;

const mergeProspect = {
  ...idParams,
  body: Joi.object({
    targetProspectId: uuid,
    target_prospect_id: uuid,
    reason: requiredText(200),
  }).or('targetProspectId', 'target_prospect_id'),
};

module.exports = {
  idParams,
  createProspect,
  updateProspect,
  listProspects,
  duplicateCheck,
  assignProspect,
  transitionProspect,
  linkProspect,
  linkageSuggestions,
  mergeProspect,
};
