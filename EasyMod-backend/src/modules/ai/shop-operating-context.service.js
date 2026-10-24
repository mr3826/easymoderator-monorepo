const crypto = require('crypto');

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
 *   - Payment ground truth (P0-3): a payment rail is advertised ONLY when the
 *     SAME authoritative enablement the checkout uses says so —
 *     PaymentConfig.is_enabled (gateway 'self-mfs') AND the owner's personal
 *     number in shop.settings.bd (shop-bd-settings). Without both, the shop is
 *     COD-only. Enabled-state lookup failure fails CLOSED to the COD-only
 *     block: an unreadable config must never widen what the bot may claim.
 *   - Courier ground truth: the shop's database-enforced AI-default delivery
 *     integration (is_ai_default + is_active + is_connected).
 *   Built fresh from the DB on every reply, so a setting change is reflected the
 *   instant the owner saves it — no re-embedding, no cache to invalidate.
 *
 * Returns '' only when shopId is missing or construction fails unexpectedly;
 * enablement/setting read failures degrade to the COD-only block above (and
 * the outbound grounding gate independently rejects payment claims without
 * enabled evidence).
 */

const { getBdSettings, hasSelfMfs } = require('../shop/shop-bd-settings');

const MFS_LABEL = { bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket' };
const COURIER_LABEL = { steadfast: 'Steadfast', redx: 'RedX', pathao: 'Pathao Courier' };

/**
 * Resolve the AI-default courier's display name, or null if none is configured.
 * Reads the provider name only (no provider-instance construction) so a shop
 * with stale credentials still reports its configured courier without throwing.
 */
const getActiveCourierName = async (shopId, { strict = false } = {}) => {
    try {
        const DeliveryIntegration = require('../delivery/delivery-integration.entity');
        const integration = await DeliveryIntegration.findOne({
            where: { shop_id: shopId, is_ai_default: true, is_active: true, is_connected: true },
            attributes: ['provider'],
        });
        if (!integration) return null;
        return COURIER_LABEL[integration.provider] || integration.provider;
    } catch (error) {
        if (strict) throw error;
        return null;
    }
};

const hashOperatingContext = (context) => {
    const value = String(context || '').trim();
    return value
        ? crypto.createHash('sha256').update(value).digest('hex')
        : null;
};

/**
 * Build the authoritative payment + delivery system-prompt block for a shop.
 * @param {string} shopId
 * @returns {Promise<string>} formatted block, or '' if it can't be built
 */
const getOperatingContext = async (shopId, { strict = false } = {}) => {
    if (!shopId) return '';
    try {
        const PaymentConfigEntity = require('../payment/payment-config.entity');
        const [bdSettings, enabledSelfMfs, courier] = await Promise.all([
            strict ? getBdSettings(shopId) : getBdSettings(shopId).catch(() => null),
            strict
                ? PaymentConfigEntity.findOne({ where: { shop_id: shopId, gateway: 'self-mfs', is_enabled: true } })
                // Fail CLOSED: an unreadable enablement must NOT advertise any
                // advance-payment rail; the COD-only block is the fallback.
                : PaymentConfigEntity.findOne({ where: { shop_id: shopId, gateway: 'self-mfs', is_enabled: true } })
                    .catch(() => null),
            getActiveCourierName(shopId, { strict }),
        ]);

        // P0-3 single authority: the number exists AND the merchant's PaymentConfig
        // enablement says the rail is on. A failed lookup fails CLOSED (the catch
        // above throws into the outer handler -> COD-only block below).
        const selfMfs = !!(enabledSelfMfs && bdSettings && hasSelfMfs(bdSettings));

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

        // Delivery coverage defaults to ALL of Bangladesh (the shop does not
        // maintain a per-area allow-list; specific zones/charges live in Delivery
        // Settings). State nationwide availability so the AI never wrongly tells a
        // customer their district is out of range.
        lines.push(
            courier
                ? `Delivery: available nationwide across Bangladesh, shipped via ${courier}; a tracking number is available after dispatch.`
                : 'Delivery: available nationwide across Bangladesh (cash on delivery). No courier is connected yet — give general delivery info only and do not promise a specific tracking number.',
            "If any FAQ or knowledge text disagrees with the payment/delivery facts in THIS section, THIS section is correct — it reflects the shop's live settings.",
        );

        return lines.join('\n');
    } catch (error) {
        if (strict) throw error;
        return '';
    }
};

module.exports = { getOperatingContext, getActiveCourierName, hashOperatingContext };
