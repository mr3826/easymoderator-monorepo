const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const { verifyShopAccess } = require('../../middleware/shop-access.middleware');
const RtoShieldController = require('./rto-shield.controller');
const { addEntrySchema, checkPhoneSchema, bulkImportSchema, listSchema } = require('./rto-shield.validator');

const router = express.Router();

// Inline Joi validation helper
const validate = (schema) => (req, res, next) => {
  const toValidate = {};
  if (schema.body) toValidate.body = req.body;
  if (schema.query) toValidate.query = req.query;
  if (schema.params) toValidate.params = req.params;

  for (const [key, joiSchema] of Object.entries(toValidate)) {
    const { error, value } = joiSchema.validate(req[key], { abortEarly: false, allowUnknown: false });
    if (error) {
      return res.status(400).json({
        success: false,
        errors: error.details.map(d => ({ field: d.path.join('.'), message: d.message }))
      });
    }
    req[key] = value;
  }
  next();
};

router.use(authenticate);
router.use(verifyShopAccess);

router.get('/', validate(listSchema), RtoShieldController.listBlacklist);
router.post('/check', validate(checkPhoneSchema), RtoShieldController.checkPhone);
router.post('/bulk-import', validate(bulkImportSchema), RtoShieldController.bulkImport);
router.post('/', validate(addEntrySchema), RtoShieldController.addToBlacklist);
router.delete('/:id', RtoShieldController.removeFromBlacklist);

module.exports = router;
