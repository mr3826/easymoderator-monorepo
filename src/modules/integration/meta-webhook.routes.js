const express = require('express');
const crypto = require('crypto');
const metaService = require('src/modules/integration/meta.service');
const MetaIntegration = require('src/modules/integration/meta-integration.entity');

const router = express.Router();

// Webhook verification (GET request from Meta)
router.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': verifyToken } = req.query;

  // Verify the webhook token
  const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (mode === 'subscribe' && verifyToken === expectedToken) {
    console.log('Meta webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    console.error('Meta webhook verification failed');
    res.sendStatus(403);
  }
});

// Webhook receiver (POST request from Meta)
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    // Verify webhook signature
    const signature = req.get('X-Hub-Signature-256');
    const expectedSignature = crypto
      .createHmac('sha256', process.env.META_APP_SECRET)
      .update(req.body)
      .digest('hex');

    if (!signature || !signature.includes(`sha256=${expectedSignature}`)) {
      console.error('Invalid webhook signature');
      return res.sendStatus(403);
    }

    const payload = JSON.parse(req.body);

    // Handle webhook based on object type
    if (payload.object === 'page') {
      await handlePageWebhook(payload);
    } else if (payload.object === 'instagram') {
      await handleInstagramWebhook(payload);
    } else if (payload.object === 'whatsapp_business_account') {
      await handleWhatsAppWebhook(payload);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.sendStatus(500);
  }
});

// Handle Facebook Messenger webhooks
async function handlePageWebhook(payload) {
  for (const entry of payload.entry) {
    const pageId = entry.id;

    // Find the integration for this page
    const integration = await MetaIntegration.findOne({
      where: { meta_asset_id: pageId, platform: 'messenger', status: 'CONNECTED' }
    });

    if (!integration) continue;

    for (const messaging of entry.messaging) {
      const normalizedEvent = {
        platform: 'messenger',
        shop_id: integration.shop_id,
        sender: messaging.sender.id,
        message: messaging.message?.text || null,
        attachments: messaging.message?.attachments || [],
        timestamp: new Date(messaging.timestamp),
        raw_event: messaging
      };

      // Forward to n8n
      await forwardToN8n(normalizedEvent);
    }
  }
}

// Handle Instagram webhooks
async function handleInstagramWebhook(payload) {
  for (const entry of payload.entry) {
    const igAccountId = entry.id;

    const integration = await MetaIntegration.findOne({
      where: { meta_asset_id: igAccountId, platform: 'instagram', status: 'CONNECTED' }
    });

    if (!integration) continue;

    for (const message of entry.messaging) {
      const normalizedEvent = {
        platform: 'instagram',
        shop_id: integration.shop_id,
        sender: message.sender.id,
        message: message.message?.text || null,
        attachments: message.message?.attachments || [],
        timestamp: new Date(message.timestamp),
        raw_event: message
      };

      await forwardToN8n(normalizedEvent);
    }
  }
}

// Handle WhatsApp webhooks
async function handleWhatsAppWebhook(payload) {
  for (const entry of payload.entry) {
    const whatsappAccountId = entry.id;

    const integration = await MetaIntegration.findOne({
      where: { meta_asset_id: whatsappAccountId, platform: 'whatsapp', status: 'CONNECTED' }
    });

    if (!integration) continue;

    for (const change of entry.changes) {
      if (change.field === 'messages') {
        for (const message of change.value.messages) {
          const normalizedEvent = {
            platform: 'whatsapp',
            shop_id: integration.shop_id,
            sender: message.from,
            message: message.text?.body || null,
            attachments: message.type !== 'text' ? [message] : [],
            timestamp: new Date(parseInt(message.timestamp) * 1000),
            raw_event: message
          };

          await forwardToN8n(normalizedEvent);
        }
      }
    }
  }
}

// Forward normalized event to n8n
async function forwardToN8n(event) {
  try {
    const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL;
    if (!n8nWebhookUrl) {
      console.warn('N8N_WEBHOOK_URL not configured, skipping webhook forwarding');
      return;
    }

    await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event)
    });

    console.log(`Forwarded ${event.platform} event to n8n for shop ${event.shop_id}`);
  } catch (error) {
    console.error('Failed to forward event to n8n:', error);
  }
}

module.exports = router;