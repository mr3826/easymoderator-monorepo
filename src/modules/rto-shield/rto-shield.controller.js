const RtoShieldService = require('./rto-shield.service');

class RtoShieldController {
  static async checkPhone(req, res) {
    try {
      const { phone } = req.body;
      const shopId = req.shop?.id || req.user?.shopId;
      const result = await RtoShieldService.checkPhone(phone, shopId);
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async addToBlacklist(req, res) {
    try {
      const shopId = req.shop?.id || req.user?.shopId;
      const addedBy = req.user?.userId;
      const entry = await RtoShieldService.addToBlacklist({ ...req.body, shop_id: shopId, added_by: addedBy });
      res.status(201).json({ success: true, data: entry });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  static async removeFromBlacklist(req, res) {
    try {
      const shopId = req.shop?.id || req.user?.shopId;
      const result = await RtoShieldService.removeFromBlacklist(req.params.id, shopId);
      res.json({ success: true, data: result });
    } catch (err) {
      const status = err.message.includes('not found') ? 404 : err.message.includes('denied') ? 403 : 400;
      res.status(status).json({ success: false, error: err.message });
    }
  }

  static async listBlacklist(req, res) {
    try {
      const shopId = req.shop?.id || req.user?.shopId;
      const { page, limit, search } = req.query;
      const result = await RtoShieldService.listBlacklist({ shopId, page: Number(page) || 1, limit: Number(limit) || 20, search });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async bulkImport(req, res) {
    try {
      const shopId = req.shop?.id || req.user?.shopId;
      const addedBy = req.user?.userId;
      const result = await RtoShieldService.bulkImport(req.body.entries, shopId, addedBy);
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}

module.exports = RtoShieldController;
