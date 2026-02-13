const express = require('express');
const knowledgeController = require('./knowledge.controller');
const knowledgeValidator = require('./knowledge.validator');
const { validate } = require('../helpers');
const { authenticate } = require('src/middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

router.get('/', validate(knowledgeValidator.getKnowledge), knowledgeController.getKnowledge);
router.put('/business-info', validate(knowledgeValidator.updateBusinessInfo), knowledgeController.updateBusinessInfo);
router.put('/branding', validate(knowledgeValidator.updateBrandingRules), knowledgeController.updateBrandingRules);
router.post('/faq/search', knowledgeController.searchFaq);
router.get('/shop-settings/:shopId/policies', knowledgeController.getPolicies);
router.post('/language/normalize', knowledgeController.normalizeLanguage);
router.post('/language/cache-learning', knowledgeController.cacheLanguageLearning);
router.post('/query', knowledgeController.queryKnowledge);

router.get('/faqs', knowledgeController.listFaqs);
router.post('/faqs', validate(knowledgeValidator.createFaq), knowledgeController.createFaq);
router.patch('/faqs/:id', validate(knowledgeValidator.updateFaq), knowledgeController.updateFaq);
router.delete('/faqs/:id', validate(knowledgeValidator.deleteFaq), knowledgeController.deleteFaq);

router.get('/gaps', knowledgeController.listGaps);
router.put('/gaps', validate(knowledgeValidator.updateGaps), knowledgeController.updateGaps);

router.get('/documents', knowledgeController.listDocuments);
router.post('/documents', validate(knowledgeValidator.createDocument), knowledgeController.createDocument);
router.delete('/documents/:id', validate(knowledgeValidator.deleteDocument), knowledgeController.deleteDocument);

module.exports = router;
