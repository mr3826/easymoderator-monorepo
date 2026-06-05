/**
 * Shop Operating Context
 *
 * Builds an authoritative, always-current snapshot of the shop's REAL payment
 * and delivery configuration, formatted as a system-prompt block.
 *
 * Why this exists:
 *   The AI reply path used to advertise bKash/Nagad/advance-payment by DEFAULT
 *   (a hardcoded persona example + a seeded "pay via bKash, Nagad" FAQ + a
 *   default payment_methods array) — none of it gated on what the shop owner
 *   actually connected. A brand-new shop accepts only Cash on Delivery, yet the
 *   bot would ask customers to "send advance via bKash" and "confirm" payment
 *   screenshots it never verified. This block is the single source of truth that
 *   overrides those stale defaults with the shop's CURRENT settings.
 *
 * Architecture:
 *   - Payment ground truth: shop.settings.bd (self-MFS = owner's personal
 *     bKash/Nagad/Rocket number) via shop-bd-settings. There is no automated
 *     online gateway — without self-MFS the shop is COD-only.
 *   - Courier ground truth: delivery_integrations (is_active + is_connected).
 *   Built fresh from the DB on every reply, so a setting change is reflected the
 *   instant the owner saves it — no re-embedding, no cache to invalidate.
 *
 * Returns '' on any failure so the caller degrades gracefully: the prompt is
 * simply un-grounded for that turn, never broken.
 */

const { getBdSettings, hasSelfMfs } = require('../shop/shop-bd-settings');

const MFS_LABEL = { bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket' };
const COURIER_LABEL = { steadfast: 'Steadfast', redx: 'RedX', pathao: 'Pathao Courier' };

/**
 * Resolve the connected courier's display name, or null if none is connected.
 * Reads the provider name only (no provider-instance construction) so a shop
 * with stale credentials still reports its courier without throwing.
 */
const getActiveCourierName = async (shopId) => {
    try {
        const DeliveryIntegration = require('../delivery/delivery-integration.entity');
        const integration = await DeliveryIntegration.findOne({
            where: { shop_id: shopId, is_active: true, is_connected: true },
            order: [['updated_at', 'DESC']],
            attributes: ['provider'],
        });
        if (!integration) return null;
        return COURIER_LABEL[integration.provider] || integration.provider;
    } catch (_) {
        return null;
    }
};

/**
 * Build the authoritative payment + delivery system-prompt block for a shop.
 * @param {string} shopId
 * @returns {Promise<string>} formatted block, or '' if it can't be built
 */
const getOperatingContext = async (shopId) => {
    if (!shopId) return '';
    try {
        const [bdSettings, courier] = await Promise.all([
            getBdSettings(shopId).catch(() => null),
            getActiveCourierName(shopId),
        ]);

        const selfMfs = !!(bdSettings && hasSelfMfs(bdSettings));

        const lines = [
            "--- SHOP PAYMENT & DELIVERY (authoritative: this shop's CURRENT settings — follow strictly) ---",
        ];

        if (selfMfs) {
            const label = MFS_LABEL[bdSettings.mfs_type] || 'mobile payment';
            lines.push(
                `Accepted payment: Cash on Delivery (COD), and advance payment via ${label} to the personal number ${bdSettings.mfs_number}.`,
                `For advance payment, ask the customer to send the amount to ${bdSettings.mfs_number} (${label}) and share the transaction ID / screenshot so it can be verified.`,
            );
        } else {
            lines.push(
                'Accepted payment: Cash on Delivery (COD) ONLY.',
                'Online / card / advance payment is NOT set up for this shop. Never ask the customer to pay first, send money in advance, or share a transaction ID/screenshot — payment is collected on delivery.',
                'If the customer sends a payment receipt or transaction screenshot, do NOT confirm or claim a payment was received. Politely explain this shop is Cash on Delivery (pay when the product arrives).',
            );
        }

        lines.push(
            courier
                ? `Delivery: orders are shipped via ${courier}; a tracking number is available after dispatch.`
                : 'Delivery: no courier is connected yet — give general delivery info only and do not promise a specific tracking number.',
            "If any FAQ or knowledge text disagrees with the payment/delivery facts in THIS section, THIS section is correct — it reflects the shop's live settings.",
        );

        return lines.join('\n');
    } catch (_) {
        return '';
    }
};

module.exports = { getOperatingContext, getActiveCourierName };
