const oauthService = require('./channel.oauth.service');

exports.initiateOAuth = async (req, res, next) => {
  try {
    const { channelType } = req.body;
    const { userId, shopId } = req.user;
    const result = await oauthService.initiateOAuth(userId, shopId, channelType);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

exports.handleOAuthCallback = async (req, res, next) => {
  try {
    const { code, state } = req.body;
    const { userId, shopId } = req.user;
    const result = await oauthService.handleCallback(code, state, userId, shopId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

exports.connectOAuthPage = async (req, res, next) => {
  try {
    const { pageId, pageName, tempToken } = req.body;
    const { userId, shopId } = req.user;
    const channel = await oauthService.connectPage(pageId, pageName, tempToken, userId, shopId);
    res.json({ success: true, data: channel });
  } catch (err) {
    next(err);
  }
};
