/**
 * Shop AI Defaults
 *
 * Canonical default values for shop AI settings.
 * Uses 'DRAFT' for BD private launch so new sellers review AI suggestions before
 * any customer-facing auto-send.
 *
 * tone_persona options:
 *   'formal'        — Professional, neutral English/Bangla
 *   'friendly_bd'   — Warm Banglish, informal apu/vai addressing (default for BD)
 *   'shop_assistant'— Helpful but slightly formal, product-focused
 */

const DEFAULT_AI_SETTINGS = {
    auto_send_enabled: false,
    auto_send_confidence_threshold: 75,

    automation_mode: 'DRAFT',
    confidence_threshold: 75,
    model_preset: 'standard',           // 'standard' (cheap) | 'advanced' (powerful)
    auto_reply_enabled: false,
    max_auto_order_value: 5000,
    ask_email: false,
    primary_language: 'mixed',

    // BD market: warm, informal Banglish persona by default
    tone_persona: 'friendly_bd',        // 'formal' | 'friendly_bd' | 'shop_assistant'

    // Greeting auto-sent on the FIRST AI reply of a conversation. The fixed Meta
    // AI-disclosure line is prepended in code (see ai-messaging.buildGreeting);
    // custom_text is the owner-editable welcome that follows it.
    greeting: {
        enabled: true,
        custom_text: 'আসসালামু আলাইকুম! 👋 কীভাবে সাহায্য করতে পারি?',
    },
    // Closing appended to the order-confirmation message. The shop's social links
    // (settings.businessInfo.socialLinks), if any, are rendered after this text.
    closing: {
        enabled: true,
        custom_text: 'আমাদের সাথে কেনাকাটা করার জন্য ধন্যবাদ! 🛍️',
    },

    // COD-only by default. bKash/Nagad must NOT be advertised until the owner
    // actually connects a method (self-MFS number under settings.bd), otherwise
    // the AI offers payment rails the shop can't accept. The live operating
    // context (shop-operating-context.service) is the AI's source of truth.
    payment_methods: ['COD'],
    escalation_reply_template:
        "ধন্যবাদ আপনার message এর জন্য! আমরা শীঘ্রই আপনার সাথে যোগাযোগ করব। (Thank you! Our team will respond within 2 hours.)",
    intent_confidence_map: {},
    required_fields: {
        customer_name: true,
        mobile_number: true,
        delivery_address: true,
        payment_method: true,
        email_address: false,
        special_instructions: false
    },
    handoff_settings: {
        trigger_keywords: ['complain', 'problem', 'issue', 'complaint', 'angry', 'refund'],
        notification_channel: 'in_app',
        cooldown_minutes: 30
    }
};

module.exports = { DEFAULT_AI_SETTINGS };
