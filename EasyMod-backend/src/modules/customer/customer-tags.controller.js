'use strict';

// MW-V1 CRM Lite — HTTP surface for merchant tags (doc 05).
const tagsService = require('./customer-tags.service');

const actorOf = (req) => ({
    userId: req.user?.userId || req.user?.id || null,
    role: req.user?.role || req.userRole || null,
    name: req.user?.full_name || null,
    email: req.user?.email || null,
});

const reply = (res, promise, status = 200) =>
    promise
        .then((data) => res.status(status).json({ success: true, data }))
        .catch((error) => res.status(error.statusCode || 500).json({
            success: false,
            error: { code: error.code || 'CUSTOMER_TAGS_FAILED', message: error.message },
        }));

exports.listVocabulary = (req, res) => reply(res, tagsService.listTags({ shopId: req.user.shopId }, actorOf(req)));
exports.createTag = (req, res) => reply(res, tagsService.createTag(
    { shopId: req.user.shopId, name: req.body.name }, actorOf(req)), 201);
exports.renameTag = (req, res) => reply(res, tagsService.renameTag(
    { shopId: req.user.shopId, tagId: req.params.tagId, name: req.body.name }, actorOf(req)));
exports.deleteTag = (req, res) => reply(res, tagsService.deleteTag(
    { shopId: req.user.shopId, tagId: req.params.tagId }, actorOf(req)));
exports.listCustomerTags = (req, res) => reply(res, tagsService.listCustomerTags(
    { shopId: req.user.shopId, customerId: req.params.id }, actorOf(req)));
exports.setCustomerTags = (req, res) => reply(res, tagsService.setCustomerTags(
    { shopId: req.user.shopId, customerId: req.params.id, tagIds: req.body.tag_ids }, actorOf(req)));
