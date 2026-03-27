/**
 * Shop AI Defaults
 *
 * Canonical default values for shop AI settings.
 * New shops default to DRAFT mode so sellers build trust before enabling AUTO.
 *
 * tone_persona options:
 *   'formal'        — Professional, neutral English/Bangla
 *   'friendly_bd'   — Warm Banglish, informal apu/vai addressing (default for BD)
 *   'shop_assistant'— Helpful but slightly formal, product-focused
 */

const DEFAULT_AI_SETTINGS = {
    // DRAFT mode ON by default — sellers approve before AI replies auto-send.
    auto_send_enabled: false,
    auto_send_confidence_threshold: 85,

    draft_mode_enabled: true,

    automation_mode: 'DRAFT',
    confidence_threshold: 75,
    model_preset: 'standard',           // 'standard' (cheap) | 'advanced' (powerful)
    auto_reply_enabled: true,
    max_auto_order_value: 5000,
    ask_email: false,
    primary_language: 'mixed',

    // BD market: warm, informal Banglish persona by default
    tone_persona: 'friendly_bd',        // 'formal' | 'friendly_bd' | 'shop_assistant'

    payment_methods: ['COD', 'bKash', 'Nagad'],
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
