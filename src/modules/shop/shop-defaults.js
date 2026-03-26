/**
 * Shop AI Defaults
 *
 * Canonical default values for shop AI settings.
 * DRAFT mode is deprecated — auto_send_enabled defaults to true with a 75%
 * confidence threshold so all new shops send automatically.
 */

const DEFAULT_AI_SETTINGS = {
    // Auto-send is ON by default; DRAFT mode is hidden/deprecated.
    auto_send_enabled: true,
    auto_send_confidence_threshold: 75,

    // draft_mode_enabled is kept for DB backward-compat but never exposed in UI.
    draft_mode_enabled: false,

    automation_mode: 'AUTO',
    confidence_threshold: 60,
    model_preset: 'standard',           // 'standard' (cheap) | 'advanced' (powerful)
    auto_reply_enabled: true,
    max_auto_order_value: 5000,
    ask_email: false,
    primary_language: 'mixed',
    payment_methods: ['COD', 'bKash', 'Nagad'],
    escalation_reply_template:
        "Thank you for reaching out! Your request has been forwarded to our team. We'll respond within 2 hours.",
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
        trigger_keywords: ['complain', 'problem', 'issue'],
        notification_channel: 'in_app',
        cooldown_minutes: 30
    }
};

module.exports = { DEFAULT_AI_SETTINGS };
