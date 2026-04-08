const { v4: uuidv4 } = require('uuid');
const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');
const productSearch = require('../product/product-search.service');

// Lazy-loaded to avoid circular dependency at module init
const getOrderServiceImports = () => require('./order.service');
const ShopEntity = require('../shop/shop.entity');
const PaymentConfigEntity = require('../payment/payment-config.entity');
const CustomerEntity = require('../customer/customer.entity');
const { getBdSettings, hasSelfMfs } = require('../shop/shop-bd-settings');
const { verifyPaymentScreenshot } = require('../payment/self-mfs-handler.service');

// Define OrderSession model directly
const OrderSession = sequelize.define('OrderSession', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    shop_id: {
        type: DataTypes.UUID,
        allowNull: false
        // Removed foreign key constraint for now
    },
    customer_id: {
        type: DataTypes.UUID,
        allowNull: true
    },
    customer_channel_id: {
        type: DataTypes.STRING,
        allowNull: false
    },
    channel: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'messenger'
    },
    current_step: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: 'INITIAL'
    },
    step_data: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {}
    },
    product_info: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: null
    },
    status: {
        type: DataTypes.ENUM('ACTIVE', 'COMPLETED', 'CANCELLED', 'ABANDONED'),
        allowNull: false,
        defaultValue: 'ACTIVE'
    },
    automation_mode: {
        type: DataTypes.ENUM('FULL_AUTO', 'DRAFT', 'NOTIFY_ONLY'),
        allowNull: false,
        defaultValue: 'DRAFT'
    },
    confidence_threshold: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 60
    },
    last_activity_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    expires_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    created_order_id: {
        type: DataTypes.UUID,
        allowNull: true
        // Removed foreign key constraint for now
    },
    final_summary: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    metadata: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {}
    }
}, {
    tableName: 'order_sessions',
    underscored: true,
    timestamps: true
});

// Table is managed by migrations — no sync needed here

// ─── Delivery zone config ─────────────────────────────────────────────────────
const ZONE_KEYS = ['inside_dhaka', 'sub_dhaka', 'outside_dhaka'];
const ZONE_LABELS = {
    inside_dhaka:  'ঢাকার ভেতরে / Inside Dhaka',
    sub_dhaka:     'ঢাকার কাছাকাছি / Sub-Dhaka',
    outside_dhaka: 'ঢাকার বাইরে / Outside Dhaka'
};
const DEFAULT_ZONE_CHARGES = { inside_dhaka: 60, sub_dhaka: 80, outside_dhaka: 120 };

// ─── Payment gateway config ───────────────────────────────────────────────────
const GATEWAY_LABELS = {
    'cod':       'ক্যাশ অন ডেলিভারি / Cash on Delivery (COD)',
    'self-mfs':  'বিকাশ / নগদ / Mobile Banking (MFS)',
    'aamarpay':  'AamarPay (অনলাইন পেমেন্ট / Online Payment)',
    'sslcommerz':'SSLCommerz (অনলাইন পেমেন্ট / Online Payment)'
};
// Payment status to use when creating the order per gateway
const GATEWAY_PAYMENT_STATUS = {
    'cod':       'unpaid',
    'self-mfs':  'pending',
    'aamarpay':  'pending',
    'sslcommerz':'pending'
};

class OrderSessionService {
    /**
     * Start a new order session
     */
    static async startOrderSession(data) {
        const {
            shop_id,
            customer_id,
            customer_channel_id,
            channel = 'messenger',
            initial_message,
            entities = {},
            product_info: incomingProductInfo = null,
            product_candidates = null   // Fix 14: array of 2+ matching products → numbered picker
        } = data;
        let product_info = incomingProductInfo;

        // Default AI settings
        const defaultAiSettings = {
            automation_mode: 'DRAFT',
            confidence_threshold: 60
        };

        // Check if there's already an active session for this customer
        const existingSession = await OrderSession.findOne({
            where: {
                shop_id,
                customer_channel_id,
                status: 'ACTIVE'
            },
            order: [['last_activity_at', 'DESC']]
        });

        if (existingSession) {
            // Resume existing session if it's not too old (24 hours)
            const hoursSinceLastActivity = (Date.now() - existingSession.last_activity_at) / (1000 * 60 * 60);
            if (hoursSinceLastActivity < 24) {
                return {
                    session_id: existingSession.id,
                    prompt: this.generateStepPrompt(existingSession.current_step, existingSession.step_data),
                    resumed: true
                };
            } else {
                // Mark old session as abandoned
                await existingSession.update({ status: 'ABANDONED' });
            }
        }

        // Fix 14: Multi-product candidates — start with SELECTING_PRODUCT step
        if (Array.isArray(product_candidates) && product_candidates.length >= 2) {
            const session = await OrderSession.create({
                id: uuidv4(),
                shop_id,
                customer_id,
                customer_channel_id,
                channel,
                current_step: 'SELECTING_PRODUCT',
                step_data: { initial_message, entities, product_candidates },
                product_info: null,
                automation_mode: 'DRAFT',
                confidence_threshold: 60,
                expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000)
            });
            return {
                session_id: session.id,
                prompt: OrderSessionService.buildProductSelectionPrompt(product_candidates),
                resumed: false
            };
        }

        // Stock gate: re-check live stock before starting order
        // product_info.id is set when the LLM identified a specific DB product
        if (product_info && product_info.id) {
            const stockCheck = await productSearch.checkStock(product_info.id, shop_id);
            if (!stockCheck.available) {
                return {
                    session_id: null,
                    prompt: this.buildOutOfStockPrompt(stockCheck.reason, product_info),
                    out_of_stock: true,
                    resumed: false
                };
            }
            // Refresh live price/stock from DB into product_info (prevents stale data)
            if (stockCheck.product) {
                product_info = {
                    ...product_info,
                    price:    stockCheck.product.price,
                    quantity: stockCheck.product.quantity,
                    in_stock: stockCheck.product.in_stock
                };
            }
        }

        // Create new session
        const session = await OrderSession.create({
            id: uuidv4(),
            shop_id,
            customer_id,
            customer_channel_id,
            channel,
            current_step: product_info ? 'COLLECTING_NAME' : 'PRODUCT_CONFIRMATION',
            step_data: {
                initial_message,
                entities,
                product_info
            },
            product_info,
            automation_mode: defaultAiSettings.automation_mode,
            confidence_threshold: defaultAiSettings.confidence_threshold,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
        });

        return {
            session_id: session.id,
            prompt: this.generateStepPrompt(session.current_step, session.step_data),
            resumed: false
        };
    }

    /**
     * Process a step in the order flow
     */
    static async processStep(sessionId, shopId, answer, rawMessage = null) {
        const session = await OrderSession.findOne({
            where: { id: sessionId, shop_id: shopId, status: 'ACTIVE' }
        });

        if (!session) {
            throw new Error('Order session not found or inactive');
        }

        // Update last activity
        await session.update({
            last_activity_at: new Date()
        });

        // Process current step
        const result = await this.handleCurrentStep(session, answer, rawMessage);

        return result;
    }

    /**
     * Handle the current step in the order flow
     */
    static async handleCurrentStep(session, answer, rawMessage) {
        const { current_step } = session;
        // Spread into a new object so Sequelize's dirty-tracking detects the change
        const step_data = { ...(session.step_data || {}) };
        let nextStep = current_step;
        let prompt = '';
        let completed = false;

        switch (current_step) {
            case 'SELECTING_PRODUCT': {
                // Fix 14: customer picks from numbered product list
                const candidates = step_data.product_candidates || [];
                const pickedNum = parseInt(answer.trim(), 10);
                if (pickedNum >= 1 && pickedNum <= candidates.length) {
                    const chosen = candidates[pickedNum - 1];
                    // Stock check on chosen product
                    if (chosen.id) {
                        const stockCheck = await productSearch.checkStock(chosen.id, session.shop_id);
                        if (!stockCheck.available) {
                            await session.update({ status: 'CANCELLED' });
                            return {
                                session_id: session.id,
                                prompt: this.buildOutOfStockPrompt(stockCheck.reason, chosen),
                                current_step: 'CANCELLED',
                                step_data,
                                completed: false,
                                cancelled: true
                            };
                        }
                        if (stockCheck.product) {
                            chosen.price    = stockCheck.product.price;
                            chosen.quantity = stockCheck.product.quantity;
                            chosen.in_stock = stockCheck.product.in_stock;
                        }
                    }
                    await session.update({ product_info: chosen });
                    session.product_info = chosen;
                    nextStep = 'COLLECTING_NAME';
                    prompt = `"${chosen.name}" নির্বাচন করেছেন ✅\n\nআপনার নাম কী? / You selected "${chosen.name}" ✅\n\nWhat's your name?`;
                } else {
                    prompt = OrderSessionService.buildProductSelectionPrompt(candidates) +
                        '\n\nঅনুগ্রহ করে সঠিক নম্বরটি লিখুন। / Please enter a valid number from the list above.';
                }
                break;
            }

            case 'PRODUCT_CONFIRMATION': {
                const confirmation = this.extractConfirmation(answer);
                if (confirmation) {
                    nextStep = 'COLLECTING_NAME';
                    prompt = 'আপনার নাম কী? / What\'s your name?';
                } else {
                    prompt = 'পণ্যটি নিশ্চিত করুন। আপনি কি এই পণ্যটি অর্ডার করতে চান? / Please confirm the product. Do you want to order this item?';
                }
                break;
            }

            case 'COLLECTING_NAME': {
                const name = answer.trim();
                if (name.length >= 2 && name.length <= 50) {
                    step_data.name = name;
                    nextStep = 'COLLECTING_PHONE';
                    prompt = 'আপনার মোবাইল নম্বর কত? / What\'s your mobile number?';
                } else {
                    prompt = 'অনুগ্রহ করে একটি বৈধ নাম দিন (২-৫০ অক্ষর)। / Please provide a valid name (2-50 characters).';
                }
                break;
            }

            case 'COLLECTING_PHONE': {
                const phone = this.extractPhoneNumber(answer);
                if (phone) {
                    // Fix 11: RTO Shield — early blacklist check before collecting address
                    try {
                        const RtoShieldService = require('../rto-shield/rto-shield.service');
                        const rtoResult = await RtoShieldService.checkPhone(phone, session.shop_id);
                        if (rtoResult.flagged) {
                            // Stay on COLLECTING_PHONE — do not advance or store the phone
                            prompt = 'দুঃখিত, এই নম্বর থেকে অর্ডার প্রক্রিয়া করা সম্ভব হচ্ছে না। আমাদের পেজে মেসেজ করুন। / Sorry, we are unable to process an order from this number. Please message our page for assistance.';
                            break;
                        }
                    } catch (_) { /* non-fatal — proceed if RTO check fails */ }
                    step_data.phone = phone;
                    nextStep = 'COLLECTING_ADDRESS';
                    prompt = 'আপনার ডেলিভারির ঠিকানা কি? / What\'s your delivery address?';
                } else {
                    prompt = 'অনুগ্রহ করে একটি বৈধ বাংলাদেশি মোবাইল নম্বর দিন (01xxxxxxxxx)। / Please provide a valid Bangladesh mobile number (01xxxxxxxxx).';
                }
                break;
            }

            case 'COLLECTING_ADDRESS': {
                const address = answer.trim();
                if (address.length >= 5) {
                    step_data.address = address;
                    // Load shop's configured delivery zones
                    const zones = await OrderSessionService.getShopDeliveryZones(session.shop_id);
                    step_data.delivery_zones = zones; // store for zone step validation
                    nextStep = 'COLLECTING_ZONE';
                    prompt = OrderSessionService.buildDeliveryZonePrompt(zones);
                } else {
                    prompt = 'অনুগ্রহ করে ঠিকানা লিখুন (যেমন: মিরপুর ১০, উত্তরা ৬)। / Please write your delivery address (e.g. Mirpur 10, Uttara 6).';
                }
                break;
            }

            case 'COLLECTING_ZONE': {
                const zones = step_data.delivery_zones || await OrderSessionService.getShopDeliveryZones(session.shop_id);
                const zoneChoice = this.extractZoneChoice(answer, zones);
                if (zoneChoice) {
                    step_data.delivery_zone = zoneChoice.zone;
                    step_data.delivery_charge = zoneChoice.charge;
                    // Load shop's enabled payment gateways for prompt and validation
                    const gateways = await OrderSessionService.getEnabledPaymentGateways(session.shop_id);
                    step_data.enabled_gateways = gateways;
                    nextStep = 'COLLECTING_PAYMENT';
                    prompt = OrderSessionService.buildPaymentPrompt(gateways, zoneChoice);
                } else {
                    prompt = OrderSessionService.buildDeliveryZonePrompt(zones) +
                        '\n\nঅনুগ্রহ করে সঠিক নম্বর বা এলাকার নাম লিখুন। / Please enter the correct number or area name.';
                }
                break;
            }

            case 'COLLECTING_PAYMENT': {
                const gateways = step_data.enabled_gateways || ['cod'];
                const gateway = this.extractPaymentGateway(answer, gateways);
                if (gateway) {
                    step_data.payment_method = gateway;
                    // For Self MFS shops, route MFS payments to screenshot verification
                    const isMfsPayment = ['bkash', 'nagad', 'rocket'].includes(gateway.toLowerCase());
                    if (isMfsPayment) {
                        const bdSettings = await getBdSettings(session.shop_id);
                        if (hasSelfMfs(bdSettings)) {
                            step_data.expected_mfs_type = bdSettings.mfs_type;
                            step_data.expected_mfs_number = bdSettings.mfs_number;
                            nextStep = 'AWAITING_MFS_SCREENSHOT';
                            const mfsLabel = bdSettings.mfs_type === 'nagad' ? 'নগদ' : bdSettings.mfs_type === 'rocket' ? 'রকেট' : 'বিকাশ';
                            prompt = `${mfsLabel} নম্বর: ${bdSettings.mfs_number}\n\nউপরের নম্বরে ৳${step_data.total || ''} পাঠিয়ে স্ক্রিনশট দিন।\nSend ৳${step_data.total || ''} to the number above and share the screenshot.`;
                        } else {
                            nextStep = 'COLLECTING_NOTES';
                            prompt = 'কোনো বিশেষ নির্দেশনা আছে? / Any special instructions for your order?';
                        }
                    } else {
                        nextStep = 'COLLECTING_NOTES';
                        prompt = 'কোনো বিশেষ নির্দেশনা আছে? / Any special instructions for your order?';
                    }
                } else {
                    prompt = OrderSessionService.buildPaymentPrompt(gateways, {
                        zone: step_data.delivery_zone,
                        charge: step_data.delivery_charge
                    }) + '\n\nঅনুগ্রহ করে সঠিক নম্বর বা পেমেন্ট পদ্ধতির নাম লিখুন। / Please enter the correct number or payment method name.';
                }
                break;
            }

            case 'AWAITING_MFS_SCREENSHOT': {
                if (step_data.mfs_payment_verified) {
                    // Already verified (e.g. re-enter from summary back)
                    nextStep = 'COLLECTING_NOTES';
                    prompt = 'কোনো বিশেষ নির্দেশনা আছে? / Any special instructions for your order?';
                    break;
                }
                // rawMessage carries the imageUrl when called from the chatbot controller
                const screenshotUrl = rawMessage?.imageUrl || null;
                if (!screenshotUrl) {
                    const mfsLabel = step_data.expected_mfs_type === 'nagad' ? 'নগদ' : step_data.expected_mfs_type === 'rocket' ? 'রকেট' : 'বিকাশ';
                    prompt = `${mfsLabel} স্ক্রিনশট পাঠান। / Please send your ${step_data.expected_mfs_type || 'MFS'} payment screenshot.`;
                    break;
                }
                const verification = await verifyPaymentScreenshot({
                    shopId: session.shop_id,
                    orderId: session.order_id,
                    imageUrl: screenshotUrl,
                    expectedAmount: step_data.total || null,
                    expectedReceiver: step_data.expected_mfs_number,
                    mfsType: step_data.expected_mfs_type
                });
                if (verification.verified) {
                    step_data.mfs_payment_verified = true;
                    step_data.mfs_trx_id = verification.trxId;
                    step_data.mfs_amount_paid = verification.amount;
                    nextStep = 'COLLECTING_NOTES';
                    prompt = `পেমেন্ট নিশ্চিত হয়েছে ✅ (TrxID: ${verification.trxId})।\nকোনো বিশেষ নির্দেশনা আছে? / Payment confirmed ✅. Any special instructions?`;
                } else {
                    prompt = `${verification.reason}\n\nআবার স্ক্রিনশট পাঠান। / Please resend the screenshot.`;
                }
                break;
            }

            case 'COLLECTING_NOTES': {
                step_data.notes = answer.trim() || null;
                nextStep = 'ORDER_SUMMARY';
                prompt = this.generateOrderSummary(session, step_data);
                break;
            }

            case 'ORDER_SUMMARY': {
                const orderConfirmation = this.extractConfirmation(answer);
                if (orderConfirmation) {
                    // Re-check stock before committing
                    const product = session.product_info;
                    if (product && product.id) {
                        const stockCheck = await productSearch.checkStock(product.id, session.shop_id);
                        if (!stockCheck.available) {
                            await session.update({ status: 'CANCELLED' });
                            return {
                                session_id: session.id,
                                prompt: this.buildOutOfStockPrompt(stockCheck.reason, product),
                                current_step: 'CANCELLED',
                                step_data,
                                completed: false,
                                cancelled: true
                            };
                        }
                    }

                    // Create the actual Order record
                    let order = null;
                    let orderPrompt;
                    try {
                        order = await OrderSessionService.createOrderFromSession(session, step_data);
                        orderPrompt = `✅ অর্ডার সফলভাবে সম্পন্ন হয়েছে! অর্ডার নম্বর: ${order.order_number}\n\n✅ Order placed successfully! Order number: ${order.order_number}`;
                    } catch (orderErr) {
                        // RTO Shield / subscription limit / other business error
                        const userMsg = orderErr.statusCode >= 400 && orderErr.statusCode < 500
                            ? orderErr.message
                            : 'অর্ডার সম্পন্ন করা যায়নি। আমাদের টিম শীঘ্রই যোগাযোগ করবে। / Could not place order. Our team will contact you shortly.';
                        return {
                            session_id: session.id,
                            prompt: userMsg,
                            current_step: 'ORDER_SUMMARY',
                            step_data,
                            completed: false
                        };
                    }

                    await session.update({
                        status: 'COMPLETED',
                        created_order_id: order.id,
                        final_summary: this.generateOrderSummary(session, step_data)
                    });

                    // Enrich customer record with collected name + phone
                    if (session.customer_id) {
                        await OrderSessionService.enrichCustomer(
                            session.customer_id,
                            step_data.name,
                            step_data.phone
                        ).catch(() => {}); // non-blocking
                    }

                    // Auto-dispatch parcel with retry (fire-and-forget — does not block confirmation)
                    setImmediate(() => OrderSessionService.dispatchParcelWithRetry(order, step_data, session.shop_id));

                    completed = true;
                    prompt = orderPrompt;
                } else {
                    nextStep = 'COLLECTING_NOTES';
                    prompt = 'কি পরিবর্তন করতে চান? / What would you like to change?';
                }
                break;
            }
        }

        // Update session with new step data
        await session.update({
            current_step: nextStep,
            step_data
        });

        return {
            session_id: session.id,
            prompt,
            current_step: nextStep,
            step_data,
            completed
        };
    }

    /**
     * Get active session for a customer
     */
    static async getActiveSession(shopId, customerChannelId) {
        return await OrderSession.findOne({
            where: {
                shop_id: shopId,
                customer_channel_id: customerChannelId,
                status: 'ACTIVE'
            },
            order: [['last_activity_at', 'DESC']]
        });
    }

    /**
     * Get session state
     */
    static async getSessionState(sessionId, shopId) {
        const session = await OrderSession.findOne({
            where: { id: sessionId, shop_id: shopId }
        });

        if (!session) {
            throw new Error('Session not found');
        }

        return {
            session_id: session.id,
            current_step: session.current_step,
            step_data: session.step_data,
            status: session.status,
            product_info: session.product_info
        };
    }

    /**
     * Cancel session
     */
    static async cancelSession(sessionId, shopId) {
        const session = await OrderSession.findOne({
            where: { id: sessionId, shop_id: shopId }
        });

        if (!session) {
            throw new Error('Session not found');
        }

        await session.update({ status: 'CANCELLED' });
        return { success: true };
    }

    // ─── Delivery helpers ─────────────────────────────────────────────────────

    /**
     * Load shop's configured delivery zones (with charges) from shop settings.
     * Falls back to default BD zone pricing if not configured.
     */
    static async getShopDeliveryZones(shopId) {
        const shop = await ShopEntity.findByPk(shopId, { attributes: ['id', 'settings'] });
        const areaPricing = shop?.settings?.delivery?.area_pricing;

        if (Array.isArray(areaPricing) && areaPricing.length > 0) {
            return areaPricing
                .filter(z => ZONE_KEYS.includes(z.zone))
                .map(z => ({
                    zone: z.zone,
                    label: ZONE_LABELS[z.zone] || z.zone,
                    charge: Number(z.charge) || DEFAULT_ZONE_CHARGES[z.zone] || 0
                }));
        }

        // Default zones
        return ZONE_KEYS.map(zone => ({
            zone,
            label: ZONE_LABELS[zone],
            charge: DEFAULT_ZONE_CHARGES[zone]
        }));
    }

    static buildDeliveryZonePrompt(zones) {
        const lines = zones.map((z, i) => `${i + 1}. ${z.label} — ৳${z.charge}`);
        return `আপনার ডেলিভারি এলাকা নির্বাচন করুন / Select your delivery area:\n${lines.join('\n')}`;
    }

    /**
     * Match customer input to a zone.
     * Accepts: position number (1/2/3), zone key, or label keywords.
     */
    static extractZoneChoice(answer, zones) {
        const t = answer.trim().toLowerCase();

        // Match by position number
        const num = parseInt(t, 10);
        if (!isNaN(num) && num >= 1 && num <= zones.length) {
            return zones[num - 1];
        }

        // Match by zone key or label keyword
        const keywords = {
            inside_dhaka:  ['inside', 'ভেতরে', 'dhaka inside', 'dhaka city', 'ঢাকা'],
            sub_dhaka:     ['sub', 'কাছাকাছি', 'sub-dhaka', 'near dhaka'],
            outside_dhaka: ['outside', 'বাইরে', 'outside dhaka', 'out of dhaka']
        };

        for (const zone of zones) {
            if (t === zone.zone || t === zone.label.toLowerCase()) return zone;
            const kws = keywords[zone.zone] || [];
            if (kws.some(kw => t.includes(kw))) return zone;
        }

        return null;
    }

    // ─── Payment helpers ──────────────────────────────────────────────────────

    /**
     * Load shop's enabled payment gateways from PaymentConfig table.
     * Returns gateway IDs ordered by preference: cod first.
     * Falls back to ['cod'] if nothing is configured.
     */
    static async getEnabledPaymentGateways(shopId) {
        const configs = await PaymentConfigEntity.findAll({
            where: { shop_id: shopId, is_enabled: true },
            attributes: ['gateway']
        });

        if (configs.length === 0) return ['cod'];

        // Sort: cod first, then self-mfs, then online gateways
        const ORDER = ['cod', 'self-mfs', 'aamarpay', 'sslcommerz'];
        return configs
            .map(c => c.gateway)
            .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    }

    static buildPaymentPrompt(gateways, zoneChoice) {
        const chargeNote = zoneChoice
            ? `ডেলিভারি চার্জ: ৳${zoneChoice.charge} (${ZONE_LABELS[zoneChoice.zone] || zoneChoice.zone})\n`
            : '';
        const lines = gateways.map((gw, i) => `${i + 1}. ${GATEWAY_LABELS[gw] || gw}`);
        return `${chargeNote}পেমেন্ট পদ্ধতি নির্বাচন করুন / Select payment method:\n${lines.join('\n')}`;
    }

    /**
     * Match customer input to an enabled gateway.
     * Accepts: position number, gateway key, or keyword (cod/cash/bkash/etc.)
     */
    static extractPaymentGateway(answer, gateways) {
        const t = answer.trim().toLowerCase();

        // Match by position number
        const num = parseInt(t, 10);
        if (!isNaN(num) && num >= 1 && num <= gateways.length) {
            return gateways[num - 1];
        }

        const keywordMap = {
            'cod':       ['cod', 'cash', 'ক্যাশ', 'cash on delivery'],
            'self-mfs':  ['bkash', 'বিকাশ', 'nagad', 'নগদ', 'mfs', 'mobile', 'self-mfs', 'self mfs'],
            'aamarpay':  ['aamarpay', 'amar pay', 'আমারপে'],
            'sslcommerz':['sslcommerz', 'ssl', 'sslc']
        };

        for (const gw of gateways) {
            if (t === gw) return gw;
            const kws = keywordMap[gw] || [];
            if (kws.some(kw => t.includes(kw))) return gw;
        }

        return null;
    }

    // ─── Order creation ───────────────────────────────────────────────────────

    /**
     * Convert a completed order session into an Order record.
     * Uses createOrderInternal (no user auth required).
     */
    static async createOrderFromSession(session, stepData) {
        const { createOrderInternal } = getOrderServiceImports();
        const product = session.product_info;

        if (!product || !product.id) {
            throw new Error('Cannot create order: no product linked to this session');
        }

        const orderData = {
            customer_id: session.customer_id || null,
            customer_name: stepData.name,
            customer_phone: stepData.phone,
            delivery_address: stepData.address,
            channel: session.channel || 'chatbot',
            items: [{
                product_id: product.id,
                quantity: product.quantity || 1
                // price omitted intentionally — server uses catalog price
            }],
            delivery_fee: stepData.delivery_charge || 0,
            payment_status: GATEWAY_PAYMENT_STATUS[stepData.payment_method] || 'pending',
            payment_method: stepData.payment_method || null,
            note: stepData.notes || null,
            // Session idempotency: use session ID so a retry yields the same order
            idempotency_key: session.id
        };

        return createOrderInternal(session.shop_id, orderData, session.id);
    }

    // ─── Customer enrichment ──────────────────────────────────────────────────

    /**
     * Update the Customer record with the name and phone collected during the session,
     * but only if the current values are missing/generic.
     */
    static async enrichCustomer(customerId, name, phone) {
        const customer = await CustomerEntity.findByPk(customerId);
        if (!customer) return;

        const updates = {};
        // Update name only if it looks like the generic placeholder set by ConversationStateService
        if (name && (!customer.name || customer.name === 'Customer' || customer.name.startsWith('Customer '))) {
            updates.name = name;
        }
        if (phone && !customer.phone) {
            updates.phone = phone;
        }

        if (Object.keys(updates).length > 0) {
            await customer.update(updates);
        }
    }

    /**
     * Auto-dispatch a parcel to the shop's active courier after order confirmation.
     * Fire-and-forget — failures are logged but do not surface to the customer.
     *
     * @param {object} order — created Order record
     * @param {object} stepData — session step_data (has name, phone, address, total, notes)
     * @param {string} shopId
     */
    static async dispatchParcel(order, stepData, shopId) {
        const { formatForCourier } = require('../delivery/bd-phone-validator.service');
        const deliveryService = require('../delivery/delivery.service');

        const orderData = {
            order_number:    order.order_number,
            customer_name:   stepData.name,
            customer_phone:  formatForCourier(stepData.phone),
            delivery_address: stepData.address,
            total:           order.total || 0,
            note:            stepData.notes || '',
            item_quantity:   (order.items || []).reduce((sum, i) => sum + (i.quantity || 1), 0) || 1,
            item_description: (order.items || []).map(i => i.name || i.product_name || '').filter(Boolean).join(', ')
        };

        try {
            await deliveryService.createDeliveryOrder(shopId, orderData);
            console.info(`[AutoParcel] Dispatched order ${order.order_number} for shop ${shopId}`);
        } catch (err) {
            console.error(`[AutoParcel] Dispatch failed for order ${order.order_number}:`, err.message);
            throw err; // re-throw so dispatchParcelWithRetry can count the attempt
        }
    }

    /**
     * Fix 12: Dispatch parcel with exponential backoff retry.
     * Attempts: 1 immediate + 2 retries (5 s, 25 s delay).
     * On total failure, marks order.delivery_status = 'dispatch_failed' so the
     * shop owner can see it in the order list and retry manually.
     *
     * @param {object} order
     * @param {object} stepData
     * @param {string} shopId
     */
    static async dispatchParcelWithRetry(order, stepData, shopId) {
        const RETRY_DELAYS_MS = [5000, 25000]; // delays between attempt 1→2 and 2→3
        const MAX_ATTEMPTS = 3;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                await OrderSessionService.dispatchParcel(order, stepData, shopId);
                return; // success — done
            } catch (err) {
                console.error(`[AutoParcel] Attempt ${attempt}/${MAX_ATTEMPTS} failed for ${order.order_number}: ${err.message}`);
                if (attempt < MAX_ATTEMPTS) {
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]));
                } else {
                    // All attempts exhausted — surface failure to shop owner via order record
                    try {
                        const { Order } = require('../entities');
                        await Order.update(
                            { delivery_status: 'dispatch_failed' },
                            { where: { id: order.id } }
                        );
                        console.error(`[AutoParcel] All ${MAX_ATTEMPTS} attempts failed. Order ${order.order_number} marked dispatch_failed.`);
                    } catch (dbErr) {
                        console.error('[AutoParcel] Failed to mark dispatch_failed on order:', dbErr.message);
                    }
                }
            }
        }
    }

    // ─── Step prompt generator (used on session resume) ───────────────────────

    /**
     * Fix 14: Build a numbered product list prompt for multi-match selection.
     */
    static buildProductSelectionPrompt(candidates) {
        const lines = candidates.map((p, i) => {
            const stockNote = p.in_stock === false ? ' [স্টক নেই / Out of stock]' : '';
            const bnName = p.name_bn ? ` (${p.name_bn})` : '';
            return `${i + 1}. ${p.name}${bnName} — ৳${p.price}${stockNote}`;
        });
        return `একাধিক পণ্য পাওয়া গেছে। কোনটি চান তার নম্বর লিখুন:\n${lines.join('\n')}\n\n---\n\nMultiple products found. Enter the number of the item you'd like to order:\n${lines.join('\n')}`;
    }

    static generateStepPrompt(step, stepData) {
        const prompts = {
            'SELECTING_PRODUCT':    'পণ্য নির্বাচন করুন / Select a product (enter a number)',
            'PRODUCT_CONFIRMATION': 'আপনি কি এই পণ্যটি অর্ডার করতে চান? / Do you want to order this item?',
            'COLLECTING_NAME':      'আপনার নাম কী? / What\'s your name?',
            'COLLECTING_PHONE':     'আপনার মোবাইল নম্বর কত? / What\'s your mobile number?',
            'COLLECTING_ADDRESS':   'আপনার ডেলিভারির ঠিকানা কি? / What\'s your delivery address?',
            'COLLECTING_ZONE':      'আপনার ডেলিভারি এলাকা নির্বাচন করুন / Select your delivery area',
            'COLLECTING_PAYMENT':      'পেমেন্ট পদ্ধতি নির্বাচন করুন / Select payment method',
            'AWAITING_MFS_SCREENSHOT': 'পেমেন্ট স্ক্রিনশট পাঠান / Send your payment screenshot',
            'COLLECTING_NOTES':        'কোনো বিশেষ নির্দেশনা আছে? / Any special instructions?',
            'ORDER_SUMMARY':        'অর্ডার নিশ্চিত করুন / Confirm order'
        };

        return prompts[step] || 'পরবর্তী ধাপে যান / Proceed to next step';
    }

    // ─── Extraction helpers ───────────────────────────────────────────────────

    static extractConfirmation(text) {
        // BD F-commerce buyers confirm with many local phrases — catch all common ones
        const confirmations = [
            'yes', 'y', 'হ্যাঁ', 'ha', 'haa', 'han', 'confirm', 'ok', 'okay',
            'ঠিক আছে', 'thik ache', 'thik ace', 'thikace',
            'send koro', 'send koren', 'pathao', 'পাঠান',
            'দিন', 'dien', 'din',
            'nibo', 'nibo bhai', 'nilam', 'নিব', 'নিলাম',
            'order dibo', 'order korbo', 'order chai', 'করব', 'korbo',
            'agree', 'done', 'ji', 'জি', 'জ্বি', 'jwi'
        ];
        const textLower = text.toLowerCase().trim();
        return confirmations.some(conf => textLower.includes(conf));
    }

    static extractPhoneNumber(text) {
        // Strip formatting characters before matching (Bangladeshi buyers often write 01711-123456)
        const cleaned = text.replace(/[\s\-().]/g, '');
        const phoneRegex = /(?:\+?880)?01[3-9]\d{8}/;
        const match = cleaned.match(phoneRegex);
        if (!match) return null;
        // Always return 11-digit local format
        return match[0].replace(/^\+?880/, '');
    }

    // ─── Out-of-stock prompt ──────────────────────────────────────────────────

    static buildOutOfStockPrompt(reason, productInfo) {
        const name = productInfo?.name || 'এই পণ্যটি';
        return `দুঃখিত! "${name}" এখন ${reason || 'স্টক আউট'}। 😔\n\n` +
            `আমাদের অন্য পণ্যগুলো দেখতে চান? অথবা অন্য কোনো সাহায্য লাগলে জানান!\n\n` +
            `---\n` +
            `Sorry! "${name}" is currently ${reason || 'out of stock'}. 😔\n` +
            `Would you like to see our other products, or can I help you with something else?`;
    }

    // ─── Order summary ────────────────────────────────────────────────────────

    static generateOrderSummary(session, stepData) {
        const product = session.product_info;
        const { name, phone, address, delivery_zone, delivery_charge, payment_method, notes } = stepData;
        const zoneLabel = ZONE_LABELS[delivery_zone] || delivery_zone || 'N/A';
        const gatewayLabel = GATEWAY_LABELS[payment_method] || payment_method || 'N/A';
        const productTotal = (product?.price || 0) * (product?.quantity || 1);
        const grandTotal = productTotal + (delivery_charge || 0);

        return `✅ অর্ডার সারসংক্ষেপ:
📦 পণ্য: ${product?.name || 'N/A'} x${product?.quantity || 1}
💰 মূল্য: ৳${productTotal}
🚚 ডেলিভারি: ৳${delivery_charge || 0} (${zoneLabel})
💳 পেমেন্ট: ${gatewayLabel}
📍 ঠিকানা: ${address}
👤 নাম: ${name} | 📞 ${phone}
${notes ? `📝 নোট: ${notes}\n` : ''}
সর্বমোট: ৳${grandTotal}

নিশ্চিত করতে "YES" লিখুন।

---

✅ Order Summary:
📦 Product: ${product?.name || 'N/A'} x${product?.quantity || 1}
💰 Price: ৳${productTotal}
🚚 Delivery: ৳${delivery_charge || 0} (${zoneLabel})
💳 Payment: ${gatewayLabel}
📍 Address: ${address}
👤 Name: ${name} | 📞 ${phone}
${notes ? `📝 Note: ${notes}\n` : ''}
Total: ৳${grandTotal}

Type "YES" to confirm.`;
    }
}

module.exports = OrderSessionService;
