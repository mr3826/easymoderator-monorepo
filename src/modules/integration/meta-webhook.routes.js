const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const config = require('src/config/config');
const MetaIntegration = require('src/modules/integration/meta-integration.entity');
const { Customer } = require('src/modules/entities');
const { Conversation, Message } = require('src/modules/conversation/conversation.entity');

const router = express.Router();

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});

router.use(webhookLimiter);

const isValidSignature = (rawBody, signature, secret) => {
  if (!signature || !secret) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
};

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
router.post('/', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const signature = req.headers['x-hub-signature-256'];
    if (config.env === 'production' && !config.metaWebhookAppSecret) {
      return res.status(500).send('Missing META_WEBHOOK_APP_SECRET');
    }

    if (config.metaWebhookAppSecret) {
      const isValid = isValidSignature(req.body, signature, config.metaWebhookAppSecret);
      if (!isValid) {
        console.error('Invalid Meta webhook signature');
        return res.sendStatus(403);
      }
    }

    const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : String(req.body || '');
    const payload = rawBody ? JSON.parse(rawBody) : {};

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

// n8n reply callback — stores bot response and sends to customer via Meta
router.post('/reply', express.json(), async (req, res) => {
  try {
    if (config.internalWebhookSecret) {
      const provided = req.headers['x-internal-webhook-secret'];
      if (provided !== config.internalWebhookSecret) {
        return res.status(403).json({ error: 'Invalid webhook secret' });
      }
    }

    const { conversation_id, shop_id, message, platform, recipient_id } = req.body;

    if (!conversation_id || !message) {
      return res.status(400).json({ error: 'conversation_id and message are required' });
    }

    // Store the bot reply as a message record
    const botMessage = await Message.create({
      conversation_id,
      content: message,
      sender: 'ai',
      external_id: null
    });

    // Send reply to customer via Meta Graph API
    if (recipient_id && platform) {
      try {
        const integration = await MetaIntegration.findOne({
          where: { shop_id, platform: platform === 'facebook' ? 'facebook' : platform, status: 'CONNECTED' }
        });

        if (integration && integration.access_token) {
          await sendMetaReply(platform, integration.access_token, recipient_id, message);
          console.log(`Sent ${platform} reply to ${recipient_id} for shop ${shop_id}`);
        } else {
          console.warn(`No active ${platform} integration for shop ${shop_id}`);
        }
      } catch (sendError) {
        console.error('Failed to send Meta reply:', sendError.message);
        // Message is still stored even if delivery fails
      }
    }

    res.status(200).json({
      success: true,
      message_id: botMessage.id,
      conversation_id
    });
  } catch (error) {
    console.error('Reply callback error:', error);
    res.status(500).json({ error: 'Failed to process reply' });
  }
});

// Send reply to customer via Meta Graph API
async function sendMetaReply(platform, accessToken, recipientId, messageText) {
  if (platform === 'whatsapp') {
    // WhatsApp Cloud API
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!phoneNumberId) {
      console.warn('WHATSAPP_PHONE_NUMBER_ID not configured');
      return;
    }
    await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipientId,
        type: 'text',
        text: { body: messageText }
      })
    });
  } else {
    // Facebook Messenger / Instagram — Send API
    await fetch('https://graph.facebook.com/v21.0/me/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: messageText },
        access_token: accessToken
      })
    });
  }
}

// Handle Facebook Messenger webhooks
async function handlePageWebhook(payload) {
  for (const entry of payload.entry) {
    const pageId = entry.id;

    const integration = await MetaIntegration.findOne({
      where: { meta_asset_id: pageId, platform: 'facebook', status: 'CONNECTED' }
    });

    if (!integration) continue;

    for (const messaging of entry.messaging) {
      const messageText = messaging.message?.text || null;
      if (!messageText) continue; // Skip non-text events (read receipts, deliveries, etc.)

      const normalizedEvent = {
        platform: 'facebook',
        shop_id: integration.shop_id,
        sender: messaging.sender.id,
        message: messageText,
        attachments: messaging.message?.attachments || [],
        timestamp: new Date(messaging.timestamp),
        raw_event: messaging
      };

      // Store in database then forward to n8n
      const stored = await storeIncomingMessage(normalizedEvent);
      await forwardToN8n({ ...normalizedEvent, ...stored });
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
      const messageText = message.message?.text || null;
      if (!messageText) continue;

      const normalizedEvent = {
        platform: 'instagram',
        shop_id: integration.shop_id,
        sender: message.sender.id,
        message: messageText,
        attachments: message.message?.attachments || [],
        timestamp: new Date(message.timestamp),
        raw_event: message
      };

      const stored = await storeIncomingMessage(normalizedEvent);
      await forwardToN8n({ ...normalizedEvent, ...stored });
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
      if (change.field === 'messages' && change.value.messages) {
        for (const message of change.value.messages) {
          const messageText = message.text?.body || null;
          if (!messageText) continue;

          const normalizedEvent = {
            platform: 'whatsapp',
            shop_id: integration.shop_id,
            sender: message.from,
            message: messageText,
            attachments: message.type !== 'text' ? [message] : [],
            timestamp: new Date(parseInt(message.timestamp) * 1000),
            raw_event: message
          };

          const stored = await storeIncomingMessage(normalizedEvent);
          await forwardToN8n({ ...normalizedEvent, ...stored });
        }
      }
    }
  }
}

/**
 * Store incoming customer message in database.
 * Find-or-create customer → find-or-create conversation → create message.
 * Returns { customer_id, conversation_id, message_id } for n8n context.
 */
async function storeIncomingMessage(event) {
  try {
    const { platform, shop_id, sender, message } = event;

    // Map platform name to channel_type ENUM value
    const channelType = platform === 'facebook' ? 'messenger' : platform;

    // 1. Find or create customer by platform sender ID
    const [customer] = await Customer.findOrCreate({
      where: {
        shop_id,
        channel_type: channelType,
        channel_user_id: sender
      },
      defaults: {
        shop_id,
        name: `${platform} user`,
        phone: sender,
        channel_type: channelType,
        channel_user_id: sender,
        metadata: { source: 'webhook', platform }
      }
    });

    // 2. Find active conversation or create new one
    // Look for a conversation from this customer in the last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let conversation = await Conversation.findOne({
      where: {
        shop_id,
        customer_id: customer.id,
        channel: channelType,
        created_at: { [require('sequelize').Op.gte]: oneDayAgo }
      },
      order: [['created_at', 'DESC']]
    });

    if (!conversation) {
      conversation = await Conversation.create({
        shop_id,
        customer_id: customer.id,
        channel: channelType,
        role: 'user',
        message: message,
        metadata: { source: 'webhook', platform }
      });
    }

    // 3. Store the message
    const msgRecord = await Message.create({
      conversation_id: conversation.id,
      content: message,
      sender: 'customer',
      external_id: event.raw_event?.message?.mid || event.raw_event?.id || null
    });

    console.log(`Stored ${platform} message: customer=${customer.id}, conv=${conversation.id}, msg=${msgRecord.id}`);

    return {
      customer_id: customer.id,
      customer_name: customer.name,
      conversation_id: conversation.id,
      message_id: msgRecord.id
    };
  } catch (error) {
    console.error('Failed to store incoming message:', error.message);
    // Don't block the webhook — still forward to n8n even if storage fails
    return { customer_id: null, conversation_id: null, message_id: null };
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
