const express = require('express');
const knowledgeController = require('./knowledge.controller');
const knowledgeValidator = require('./knowledge.validator');
const { validate } = require('../helpers');
const { authenticate } = require('../../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

router.get('/', validate(knowledgeValidator.getKnowledge), knowledgeController.getKnowledge);
// Business info is managed via PUT /shop/business-info — keeping GET /knowledge/ as the read endpoint.
router.put('/branding', validate(knowledgeValidator.updateBrandingRules), knowledgeController.updateBrandingRules);
router.post('/faq/search', knowledgeController.searchFaq);
router.get('/shop-settings/:shopId/policies', knowledgeController.getPolicies);
router.post('/language/normalize', knowledgeController.normalizeLanguage);
// Writing to the shared Banglish dictionary is restricted to admins to prevent poisoning.
router.post('/language/cache-learning', (req, res, next) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin role required.' } });
    }
    next();
}, knowledgeController.cacheLanguageLearning);
router.post('/query', knowledgeController.queryKnowledge);

router.get('/faqs', knowledgeController.listFaqs);
router.post('/faqs', validate(knowledgeValidator.createFaq), knowledgeController.createFaq);
// One-tap onboarding: seed the BD f-commerce starter FAQ pack (idempotent — only
// seeds when the shop has no FAQs yet). Lets a new seller skip cold-start typing.
router.post('/faqs/seed-starter', knowledgeController.seedStarterFaqs);
router.patch('/faqs/:id', validate(knowledgeValidator.updateFaq), knowledgeController.updateFaq);
router.delete('/faqs/:id', validate(knowledgeValidator.deleteFaq), knowledgeController.deleteFaq);

router.get('/gaps', knowledgeController.listGaps);

router.get('/documents', knowledgeController.listDocuments);
router.post('/documents', validate(knowledgeValidator.createDocument), knowledgeController.createDocument);
router.delete('/documents/:id', validate(knowledgeValidator.deleteDocument), knowledgeController.deleteDocument);

module.exports = router;
