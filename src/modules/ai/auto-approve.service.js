/**
 * Auto-Approve Service
 *
 * Determines whether an AI-generated response should be sent directly to the
 * customer (skipping DRAFT / human-review mode) based on the response
 * confidence score and the shop's configured threshold.
 *
 * Configuration (stored in shop settings.ai):
 *   auto_send_confidence_threshold: number | null
 *     - null  → feature disabled; all responses go through DRAFT
 *     - 0–100 → auto-send if AI confidence >= this value
 *
 * The default value (85) is already defined in shop.service.js
 * getShopAiSettings() defaults, so no migration is required.
 */

const shopService = require('../shop/shop.service');

/**
 * Read the auto-send confidence threshold for a shop.
 *
 * @param {string} shopId
 * @returns {Promise<number|null>} threshold 0–100, or null if disabled
 */
const getThreshold = async (shopId) => {
    try {
        const aiSettings = await shopService.getShopAiSettings(shopId);
        if (!aiSettings) return null;

        const raw = aiSettings.auto_send_confidence_threshold;

        // Explicit null / undefined / false → feature disabled
        if (raw === null || raw === undefined || raw === false) return null;

        const threshold = Number(raw);

        // Sanity-check: must be a finite number in [0, 100]
        if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
            console.warn(
                `[AutoApprove] Invalid threshold value "${raw}" for shop ${shopId}. Feature disabled.`
            );
            return null;
        }

        return threshold;
    } catch (err) {
        console.warn(`[AutoApprove] Could not read threshold for shop ${shopId}: ${err.message}`);
        return null;
    }
};

/**
 * Decide whether a response with the given confidence should be auto-approved.
 *
 * @param {number} confidence - AI confidence score (0–100)
 * @param {string} shopId     - Shop to look up threshold for
 * @returns {Promise<boolean>} true → send directly; false → put in DRAFT
 */
const shouldAutoApprove = async (confidence, shopId) => {
    if (confidence === null || confidence === undefined) return false;

    const threshold = await getThreshold(shopId);

    // threshold === null means feature is disabled
    if (threshold === null) return false;

    return Number(confidence) >= threshold;
};

module.exports = { shouldAutoApprove, getThreshold };
