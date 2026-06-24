const { v4: uuidv4 } = require('uuid');
const { DataTypes, Op } = require('sequelize');
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
    inside_dhaka:  { bn: 'ঢাকার ভেতরে', en: 'Inside Dhaka' },
    sub_dhaka:     { bn: 'ঢাকার কাছাকাছি', en: 'Sub-Dhaka' },
    outside_dhaka: { bn: 'ঢাকার বাইরে', en: 'Outside Dhaka' }
};
const DEFAULT_ZONE_CHARGES = { inside_dhaka: 60, sub_dhaka: 80, outside_dhaka: 120 };

// ─── Zone auto-detection keywords ─────────────────────────────────────────────
// Map a free-text address to a delivery zone so the bot can apply the charge
// itself instead of always asking "inside or outside Dhaka?" (founder 2026-06-13:
// detect from the address; only ask when unsure). Lowercased substring match —
// best-effort and fail-safe: no confident hit ⇒ fall back to asking.
const ZONE_AREA_KEYWORDS = {
    // Dhaka-city thanas / neighbourhoods → inside_dhaka
    inside_dhaka: [
        'mirpur', 'uttara', 'dhanmondi', 'dhanmandi', 'gulshan', 'banani', 'mohammadpur',
        'motijheel', 'badda', 'rampura', 'bashundhara', 'baridhara', 'tejgaon', 'farmgate',
        'mohakhali', 'malibagh', 'khilgaon', 'jatrabari', 'jatra bari', 'wari', 'lalbagh',
        'kotwali', 'paltan', 'shahbag', 'shahbagh', 'new market', 'newmarket', 'azimpur',
        'shyamoli', 'kalabagan', 'panthapath', 'kakrail', 'shantinagar', 'mugda', 'khilkhet',
        'cantonment', 'agargaon', 'kafrul', 'pallabi', 'kazipara', 'shewrapara', 'demra',
        'sabujbagh', 'hazaribagh', 'shyampur', 'gendaria', 'sutrapur', 'chawkbazar', 'bangshal',
        'nikunja', 'adabor', 'ramna', 'hatirjheel', 'gulistan', 'mouchak', 'banasree', 'banashree',
        'bashabo', 'maghbazar', 'moghbazar', 'kuril', 'vatara', 'jurain',
        'মিরপুর', 'উত্তরা', 'ধানমন্ডি', 'গুলশান', 'বনানী', 'মোহাম্মদপুর', 'মতিঝিল', 'বাড্ডা',
        'রামপুরা', 'বসুন্ধরা', 'বারিধারা', 'তেজগাঁও', 'ফার্মগেট', 'মহাখালী', 'মালিবাগ', 'খিলগাঁও',
        'যাত্রাবাড়ী', 'ওয়ারী', 'লালবাগ', 'পল্টন', 'শাহবাগ', 'আজিমপুর', 'শ্যামলী', 'কলাবাগান',
        'পান্থপথ', 'কাকরাইল', 'শান্তিনগর', 'মুগদা', 'খিলক্ষেত', 'ক্যান্টনমেন্ট', 'আগারগাঁও',
        'পল্লবী', 'বনশ্রী', 'বাসাবো', 'মগবাজার', 'গুলিস্তান',
    ],
    // Greater-Dhaka / suburbs → sub_dhaka
    sub_dhaka: [
        'savar', 'ashulia', 'keraniganj', 'dhamrai', 'nabinagar', 'tongi', 'gazipur',
        'narayanganj', 'fatullah', 'siddhirganj', 'rupganj', 'sonargaon', 'board bazar',
        'kaliakair', 'joydebpur', 'kanchpur', 'hemayetpur',
        'সাভার', 'আশুলিয়া', 'কেরানীগঞ্জ', 'ধামরাই', 'টঙ্গী', 'গাজীপুর', 'নারায়ণগঞ্জ',
        'ফতুল্লা', 'সিদ্ধিরগঞ্জ', 'রূপগঞ্জ', 'সোনারগাঁও', 'জয়দেবপুর',
    ],
    // Other districts / divisions → outside_dhaka
    outside_dhaka: [
        'chittagong', 'chattogram', 'sylhet', 'rajshahi', 'khulna', 'barisal', 'barishal',
        'rangpur', 'mymensingh', 'comilla', 'cumilla', 'kushtia', 'bogura', 'bogra', 'jessore',
        'jashore', 'dinajpur', 'cox', 'feni', 'noakhali', 'brahmanbaria', 'tangail', 'pabna',
        'sirajganj', 'narsingdi', 'faridpur', 'gopalganj', 'madaripur', 'shariatpur', 'jamalpur',
        'sherpur', 'netrokona', 'kishoreganj', 'manikganj', 'munshiganj', 'magura', 'jhenaidah',
        'chuadanga', 'meherpur', 'satkhira', 'bagerhat', 'narail', 'pirojpur', 'patuakhali',
        'bhola', 'barguna', 'gaibandha', 'kurigram', 'lalmonirhat', 'nilphamari', 'panchagarh',
        'thakurgaon', 'joypurhat', 'naogaon', 'natore', 'chapainawabganj', 'habiganj',
        'moulvibazar', 'sunamganj', 'lakshmipur', 'chandpur', 'khagrachari', 'rangamati', 'bandarban',
        'চট্টগ্রাম', 'সিলেট', 'রাজশাহী', 'খুলনা', 'বরিশাল', 'রংপুর', 'ময়মনসিংহ', 'কুমিল্লা',
        'কুষ্টিয়া', 'বগুড়া', 'যশোর', 'দিনাজপুর', 'কক্সবাজার', 'ফেনী', 'নোয়াখালী',
        'ব্রাহ্মণবাড়িয়া', 'টাঙ্গাইল', 'পাবনা', 'সিরাজগঞ্জ', 'নরসিংদী', 'ফরিদপুর', 'চাঁদপুর',
    ],
};
// Most-specific first: a named city neighbourhood wins over the generic word "Dhaka".
const ZONE_DETECT_ORDER = ['inside_dhaka', 'sub_dhaka', 'outside_dhaka'];

// ─── Payment gateway config ───────────────────────────────────────────────────
const GATEWAY_LABELS = {
    'cod':      { bn: 'ক্যাশ অন ডেলিভারি (COD)', en: 'Cash on Delivery (COD)' },
    'self-mfs': { bn: 'বিকাশ / নগদ (মোবাইল ব্যাংকিং)', en: 'bKash / Nagad (Mobile Banking)' }
};
// Payment status to use when creating the order per gateway
const GATEWAY_PAYMENT_STATUS = {
    'cod':      'unpaid',
    'self-mfs': 'pending'
};

// Reply in ONE language, matching the customer: Bengali for Bengali/Banglish/mixed,
// English only when the customer clearly writes English. (Founder feedback 2026-06-12:
// the order flow must never answer in Bengali AND English at once.)
const pickLang = (lang, bn, en) => (lang === 'en' ? en : bn);
const zoneLabel = (zone, lang) => (ZONE_LABELS[zone] ? pickLang(lang, ZONE_LABELS[zone].bn, ZONE_LABELS[zone].en) : zone);
const gatewayLabel = (gw, lang) => (GATEWAY_LABELS[gw] ? pickLang(lang, GATEWAY_LABELS[gw].bn, GATEWAY_LABELS[gw].en) : gw);

// Bengali (০-৯) + English digits, and the most common BD spoken quantities, → integer.
// Used by the COLLECTING_QUANTITY step so the bot verifies "koyta?" instead of
// silently assuming 1 piece (founder feedback 2026-06-12).
const BN_DIGITS = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' };
const QTY_WORDS = {
    ekta: 1, akta: 1, ektা: 1, একটা: 1, একটি: 1, ek: 1, এক: 1, one: 1, single: 1,
    duita: 2, duito: 2, dui: 2, duto: 2, দুইটা: 2, দুটি: 2, দুটো: 2, দুই: 2, two: 2,
    tinta: 3, tin: 3, তিনটা: 3, তিনটি: 3, তিন: 3, three: 3,
    charta: 4, char: 4, চারটা: 4, চারটি: 4, চার: 4, four: 4,
    pachta: 5, pach: 5, পাঁচটা: 5, পাঁচ: 5, five: 5,
};
const extractQuantity = (text) => {
    if (!text || typeof text !== 'string') return null;
    let t = text.toLowerCase().trim();
    // Normalise Bengali numerals to ASCII digits first.
    t = t.replace(/[০-৯]/g, (d) => BN_DIGITS[d] || d);
    // A bare/embedded number wins ("2", "2 ta", "2 piece", "ami 3 ta nibo").
    const num = t.match(/\d{1,2}/);
    if (num) {
        const n = parseInt(num[0], 10);
        if (n >= 1 && n <= 99) return n;
        return null;
    }
    // Otherwise look for a spoken-quantity word.
    for (const [word, value] of Object.entries(QTY_WORDS)) {
        if (new RegExp(`(^|\\s)${word}(\\s|$)`).test(t)) return value;
    }
    return null;
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
            language = 'bn',            // 'bn' | 'en' | 'mixed' — single-language replies
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
                    prompt: this.generateStepPrompt(existingSession.current_step, existingSession.step_data, existingSession.step_data?.language),
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
                step_data: { initial_message, entities, language, product_candidates },
                product_info: null,
                automation_mode: 'DRAFT',
                confidence_threshold: 60,
                expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000)
            });
            return {
                session_id: session.id,
                prompt: OrderSessionService.buildProductSelectionPrompt(product_candidates, language),
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
                    prompt: this.buildOutOfStockPrompt(stockCheck.reason, product_info, language),
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
            // When we already know the product, jump straight to asking the quantity
            // ("koyta niben?") — the bot must verify pieces, not assume 1.
            current_step: product_info ? 'COLLECTING_QUANTITY' : 'PRODUCT_CONFIRMATION',
            step_data: {
                initial_message,
                entities,
                language,
                product_info
            },
            product_info,
            automation_mode: defaultAiSettings.automation_mode,
            confidence_threshold: defaultAiSettings.confidence_threshold,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
        });

        return {
            session_id: session.id,
            prompt: this.generateStepPrompt(session.current_step, session.step_data, language),
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
        const lang = step_data.language || 'bn'; // single-language replies (match the customer)
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
                                prompt: this.buildOutOfStockPrompt(stockCheck.reason, chosen, lang),
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
                    nextStep = 'COLLECTING_QUANTITY';
                    prompt = pickLang(lang,
                        `"${chosen.name}" নির্বাচন করেছেন ✅\n\nকয়টা নিবেন?`,
                        `You selected "${chosen.name}" ✅\n\nHow many would you like?`);
                } else {
                    prompt = OrderSessionService.buildProductSelectionPrompt(candidates, lang) +
                        pickLang(lang,
                            '\n\nঅনুগ্রহ করে সঠিক নম্বরটি লিখুন।',
                            '\n\nPlease enter a valid number from the list above.');
                }
                break;
            }

            case 'PRODUCT_CONFIRMATION': {
                const confirmation = this.extractConfirmation(answer);
                if (confirmation) {
                    nextStep = 'COLLECTING_QUANTITY';
                    prompt = pickLang(lang, 'কয়টা নিবেন?', 'How many would you like?');
                } else {
                    prompt = pickLang(lang,
                        'পণ্যটি নিশ্চিত করুন। আপনি কি এই পণ্যটি অর্ডার করতে চান?',
                        'Please confirm the product. Do you want to order this item?');
                }
                break;
            }

            case 'COLLECTING_QUANTITY': {
                const qty = extractQuantity(answer);
                if (qty) {
                    // Verify the requested quantity is actually in stock NOW, before we
                    // walk the customer through name/phone/address only to fail at order
                    // creation with a scary generic error. checkStock without a quantity
                    // defaulted to 1, so "I want 3" of a 2-in-stock item sailed through.
                    // Fail-open: a stock-lookup error must never block a real order.
                    const prod = session.product_info || {};
                    if (prod.id) {
                        const stock = await productSearch.checkStock(prod.id, session.shop_id, qty)
                            .catch(() => ({ available: true }));
                        if (!stock.available && typeof stock.quantity === 'number') {
                            // Not enough units — tell them how many remain and re-ask. Stay on step.
                            prompt = pickLang(lang,
                                `দুঃখিত, এই মুহূর্তে স্টকে আছে ${stock.quantity}টি। কয়টা নিতে চান?`,
                                `Sorry, only ${stock.quantity} in stock right now. How many would you like?`);
                            break;
                        }
                    }
                    // Quantity lives on product_info so the (last-configured) item
                    // is always available; the cart is the source of truth for the
                    // full multi-product order.
                    const pi = { ...prod, quantity: qty };
                    await session.update({ product_info: pi });
                    session.product_info = pi;

                    // Append the configured item to the cart, then offer add-another.
                    const cartItem = {
                        product_id: pi.id,
                        name: pi.name,
                        name_bn: pi.name_bn || null,
                        price: pi.price,
                        quantity: qty,
                    };
                    step_data.cart = [...(step_data.cart || []), cartItem];
                    nextStep = 'ADD_MORE';
                    prompt = OrderSessionService.buildAddMorePrompt(pi, step_data.cart, lang);
                } else {
                    prompt = pickLang(lang,
                        'কয়টা পণ্য নিতে চান? সংখ্যায় লিখুন (যেমন: ১, ২, ৩)।',
                        'How many would you like? Please reply with a number (e.g. 1, 2, 3).');
                }
                break;
            }

            // Multi-product loop: after each item is carted we ask whether to add
            // another or proceed to checkout. "done"/"শেষ" → checkout; a bare
            // affirmation → ask which product; anything else is treated as the next
            // product to identify (name or photo).
            case 'ADD_MORE': {
                if (OrderSessionService.isCheckoutWord(answer)) {
                    nextStep = 'COLLECTING_NAME';
                    prompt = pickLang(lang, 'আপনার নাম কী?', "What's your name?");
                    break;
                }
                if (OrderSessionService.isBareAddWord(answer)) {
                    nextStep = 'ADDING_PRODUCT';
                    prompt = pickLang(lang,
                        'কোন পণ্যটি যোগ করতে চান? নাম লিখুন বা ছবি পাঠান।',
                        'Which product would you like to add? Send the name or a photo.');
                    break;
                }
                // Treat the message as the next product(s) — one name, or several
                // in one go ("2 lawn and 1 dupatta") via free-text parsing.
                ({ nextStep, prompt } = await OrderSessionService.applyLineItems(session, step_data, answer, rawMessage, lang));
                break;
            }

            case 'ADDING_PRODUCT': {
                ({ nextStep, prompt } = await OrderSessionService.applyLineItems(session, step_data, answer, rawMessage, lang));
                break;
            }

            case 'COLLECTING_NAME': {
                const name = answer.trim();
                // Customers often echo a confirmation ("confirm korun", "ok") right
                // after the session starts — that's not their name. Exact-match only,
                // so real names containing these substrings ("Jia", "Hannan") pass.
                if (OrderSessionService.isBareConfirmationWord(name)) {
                    prompt = pickLang(lang, 'অনুগ্রহ করে আপনার নাম লিখুন।', 'Please write your name.');
                    break;
                }
                if (name.length >= 2 && name.length <= 50) {
                    step_data.name = name;
                    nextStep = 'COLLECTING_PHONE';
                    prompt = pickLang(lang, 'আপনার মোবাইল নম্বর কত?', "What's your mobile number?");
                } else {
                    prompt = pickLang(lang,
                        'অনুগ্রহ করে একটি বৈধ নাম দিন (২-৫০ অক্ষর)।',
                        'Please provide a valid name (2-50 characters).');
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
                            prompt = pickLang(lang,
                                'দুঃখিত, এই নম্বর থেকে অর্ডার প্রক্রিয়া করা সম্ভব হচ্ছে না। আমাদের পেজে মেসেজ করুন।',
                                'Sorry, we are unable to process an order from this number. Please message our page for assistance.');
                            break;
                        }
                    } catch (_) { /* non-fatal — proceed if RTO check fails */ }
                    step_data.phone = phone;
                    nextStep = 'COLLECTING_ADDRESS';
                    prompt = pickLang(lang, 'আপনার ডেলিভারির ঠিকানা কি?', "What's your delivery address?");
                } else {
                    prompt = pickLang(lang,
                        'অনুগ্রহ করে একটি বৈধ বাংলাদেশি মোবাইল নম্বর দিন (01xxxxxxxxx)।',
                        'Please provide a valid Bangladesh mobile number (01xxxxxxxxx).');
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
                    // Try to infer the zone from the address so we apply the charge
                    // ourselves; only ask the inside/outside question when unsure.
                    const detectedZone = OrderSessionService.detectZoneFromAddress(address, zones);
                    if (detectedZone) {
                        const adv = await OrderSessionService._advanceAfterZone(session, step_data, detectedZone, lang, true);
                        nextStep = adv.nextStep;
                        prompt = adv.prompt;
                    } else {
                        nextStep = 'COLLECTING_ZONE';
                        prompt = OrderSessionService.buildDeliveryZonePrompt(zones, lang);
                    }
                } else {
                    prompt = pickLang(lang,
                        'অনুগ্রহ করে ঠিকানা লিখুন (যেমন: মিরপুর ১০, উত্তরা ৬)।',
                        'Please write your delivery address (e.g. Mirpur 10, Uttara 6).');
                }
                break;
            }

            case 'COLLECTING_ZONE': {
                const zones = step_data.delivery_zones || await OrderSessionService.getShopDeliveryZones(session.shop_id);
                const zoneChoice = this.extractZoneChoice(answer, zones);
                if (zoneChoice) {
                    const adv = await OrderSessionService._advanceAfterZone(session, step_data, zoneChoice, lang, false);
                    nextStep = adv.nextStep;
                    prompt = adv.prompt;
                } else {
                    prompt = OrderSessionService.buildDeliveryZonePrompt(zones, lang) +
                        pickLang(lang,
                            '\n\nঅনুগ্রহ করে সঠিক নম্বর বা এলাকার নাম লিখুন।',
                            '\n\nPlease enter the correct number or area name.');
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
                            prompt = pickLang(lang,
                                `${mfsLabel} নম্বর: ${bdSettings.mfs_number}\n\nউপরের নম্বরে ৳${step_data.total || ''} পাঠিয়ে স্ক্রিনশট দিন।`,
                                `${mfsLabel} number: ${bdSettings.mfs_number}\n\nSend ৳${step_data.total || ''} to the number above and share the screenshot.`);
                        } else {
                            nextStep = 'COLLECTING_NOTES';
                            prompt = pickLang(lang, 'কোনো বিশেষ নির্দেশনা আছে?', 'Any special instructions for your order?');
                        }
                    } else {
                        nextStep = 'COLLECTING_NOTES';
                        prompt = pickLang(lang, 'কোনো বিশেষ নির্দেশনা আছে?', 'Any special instructions for your order?');
                    }
                } else {
                    prompt = OrderSessionService.buildPaymentPrompt(gateways, {
                        zone: step_data.delivery_zone,
                        charge: step_data.delivery_charge
                    }, lang) + pickLang(lang,
                        '\n\nঅনুগ্রহ করে সঠিক নম্বর বা পেমেন্ট পদ্ধতির নাম লিখুন।',
                        '\n\nPlease enter the correct number or payment method name.');
                }
                break;
            }

            case 'AWAITING_MFS_SCREENSHOT': {
                if (step_data.mfs_payment_verified) {
                    // Already verified (e.g. re-enter from summary back)
                    nextStep = 'COLLECTING_NOTES';
                    prompt = pickLang(lang, 'কোনো বিশেষ নির্দেশনা আছে?', 'Any special instructions for your order?');
                    break;
                }
                // rawMessage carries the imageUrl when called from the chatbot controller
                const screenshotUrl = rawMessage?.imageUrl || null;
                if (!screenshotUrl) {
                    const mfsLabel = step_data.expected_mfs_type === 'nagad' ? 'নগদ' : step_data.expected_mfs_type === 'rocket' ? 'রকেট' : 'বিকাশ';
                    prompt = pickLang(lang,
                        `${mfsLabel} স্ক্রিনশট পাঠান।`,
                        `Please send your ${step_data.expected_mfs_type || 'MFS'} payment screenshot.`);
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
                    prompt = pickLang(lang,
                        `পেমেন্ট নিশ্চিত হয়েছে ✅ (TrxID: ${verification.trxId})।\nকোনো বিশেষ নির্দেশনা আছে?`,
                        `Payment confirmed ✅ (TrxID: ${verification.trxId}). Any special instructions?`);
                } else {
                    prompt = `${verification.reason}\n\n` + pickLang(lang, 'আবার স্ক্রিনশট পাঠান।', 'Please resend the screenshot.');
                }
                break;
            }

            case 'COLLECTING_NOTES': {
                // A bare "no/na/nai" means "no special instructions" — store null, not the word.
                const rawNote = answer.trim();
                const isNoNote = /^(no|none|na|nah|nope|নাই|না|নেই|nai|nei)\.?$/i.test(rawNote);
                step_data.notes = (!rawNote || isNoNote) ? null : rawNote;
                nextStep = 'ORDER_SUMMARY';
                prompt = this.generateOrderSummary(session, step_data, lang);
                break;
            }

            case 'ORDER_SUMMARY': {
                // A per-line edit ("remove the dupatta", "saree 3 ta koro") takes
                // priority over confirmation: extractConfirmation uses includes(),
                // so an edit phrase containing a confirm-substring must NOT place
                // the order. Only fall through to confirm when it's not an edit.
                const summaryCart = OrderSessionService.getCartItems(session, step_data);
                const edit = OrderSessionService.detectCartEdit(answer, summaryCart);
                if (edit.action) {
                    ({ nextStep, prompt, completed } =
                        await OrderSessionService.applyCartEdit(session, step_data, edit, summaryCart, lang));
                    break;
                }

                const orderConfirmation = this.extractConfirmation(answer);
                if (orderConfirmation) {
                    // Re-check stock for EVERY line in the cart before committing.
                    const cart = OrderSessionService.getCartItems(session, step_data);
                    for (const item of cart) {
                        if (!item.product_id) continue;
                        const stockCheck = await productSearch.checkStock(item.product_id, session.shop_id, item.quantity || 1);
                        if (!stockCheck.available) {
                            await session.update({ status: 'CANCELLED' });
                            return {
                                session_id: session.id,
                                prompt: this.buildOutOfStockPrompt(stockCheck.reason, item, lang),
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
                        orderPrompt = pickLang(lang,
                            `✅ অর্ডার সফলভাবে সম্পন্ন হয়েছে! অর্ডার নম্বর: ${order.order_number}`,
                            `✅ Order placed successfully! Order number: ${order.order_number}`);

                        // Issue the customer's invoice in the same confirmation message.
                        // Invoice failure must never un-confirm a created order.
                        try {
                            const { issueInvoiceForOrder } = require('../invoice/chat-invoice.service');
                            const { text: invoiceText } = await issueInvoiceForOrder(order, {
                                channel: session.channel || 'messenger',
                                items: cart.length ? cart.map(c => ({
                                    name: c.name,
                                    quantity: c.quantity || 1,
                                    price: c.price,
                                    total: (c.price || 0) * (c.quantity || 1)
                                })) : null
                            });
                            orderPrompt += `\n\n${invoiceText}`;
                        } catch (invErr) {
                            console.error(`[OrderSession] Invoice generation failed for order ${order.order_number}:`, invErr.message);
                        }

                        // Append the shop's closing message (thank-you + "follow us"
                        // social links) to the confirmation. Best-effort — a failure
                        // here must never un-confirm an order that was already created.
                        try {
                            const closingText = await OrderSessionService.buildShopClosing(session.shop_id, lang);
                            if (closingText) orderPrompt += `\n\n${closingText}`;
                        } catch (closeErr) {
                            console.error(`[OrderSession] Closing message failed for order ${order.order_number}:`, closeErr.message);
                        }
                    } catch (orderErr) {
                        // Surface genuine business rejections (out of stock, COD limit,
                        // RTO block, product not found) to the customer with their real
                        // reason. AppError exposes the HTTP code as `.status` (NOT
                        // `.statusCode`) — reading the wrong property made every 4xx look
                        // like a 5xx, so customers saw the scary "our team will contact
                        // you" generic instead of "only 2 left in stock". Log the real
                        // error too (the old catch swallowed it, hiding the root cause).
                        const errCode = orderErr.status ?? orderErr.statusCode;
                        console.error(`[OrderSession] Order creation failed for session ${session.id} (code=${errCode}):`, orderErr.message);
                        const userMsg = (errCode >= 400 && errCode < 500)
                            ? orderErr.message
                            : pickLang(lang,
                                'অর্ডার সম্পন্ন করা যায়নি। আমাদের টিম শীঘ্রই যোগাযোগ করবে।',
                                'Could not place order. Our team will contact you shortly.');
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
                    prompt = pickLang(lang, 'কি পরিবর্তন করতে চান?', 'What would you like to change?');
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
        // Only resume a session that is still within its TTL. A session left stuck at
        // ORDER_SUMMARY (e.g. order creation kept failing) was otherwise resurfaced on
        // EVERY later message — the customer felt the bot was "stuck on old data" and
        // could never start fresh. Drop expired rows; keep legacy rows with null expiry.
        return await OrderSession.findOne({
            where: {
                shop_id: shopId,
                customer_channel_id: customerChannelId,
                status: 'ACTIVE',
                [Op.or]: [
                    { expires_at: { [Op.gt]: new Date() } },
                    { expires_at: { [Op.is]: null } }
                ]
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
                    charge: Number(z.charge) || DEFAULT_ZONE_CHARGES[z.zone] || 0
                }));
        }

        // Default zones
        return ZONE_KEYS.map(zone => ({
            zone,
            charge: DEFAULT_ZONE_CHARGES[zone]
        }));
    }

    static buildDeliveryZonePrompt(zones, lang = 'bn') {
        const lines = zones.map((z, i) => `${i + 1}. ${zoneLabel(z.zone, lang)} — ৳${z.charge}`);
        const header = pickLang(lang, 'আপনার ডেলিভারি এলাকা নির্বাচন করুন:', 'Select your delivery area:');
        return `${header}\n${lines.join('\n')}`;
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
            if (t === zone.zone) return zone;
            const kws = keywords[zone.zone] || [];
            if (kws.some(kw => t.includes(kw))) return zone;
        }

        return null;
    }

    /**
     * Best-effort infer the delivery zone from a free-text address so the bot can
     * apply the charge without asking. Returns the matching configured zone object
     * ({ zone, charge }) or null when the address gives no confident signal (→ ask).
     * A named Dhaka-city area beats the bare word "Dhaka"; only zones the shop has
     * actually configured are eligible.
     */
    static detectZoneFromAddress(address, zones) {
        if (!address || !Array.isArray(zones) || zones.length === 0) return null;
        const t = String(address).toLowerCase();
        const configured = new Set(zones.map(z => z.zone));
        for (const zoneKey of ZONE_DETECT_ORDER) {
            if (!configured.has(zoneKey)) continue;
            const kws = ZONE_AREA_KEYWORDS[zoneKey] || [];
            if (kws.some(kw => t.includes(kw))) {
                return zones.find(z => z.zone === zoneKey) || null;
            }
        }
        return null;
    }

    /**
     * Apply a chosen/detected delivery zone and move the flow forward: record the
     * zone + charge, load the shop's gateways, and route to payment (or straight to
     * notes when COD is the only option). Shared by the manual zone pick and the
     * address auto-detection so both behave identically.
     *
     * @param {boolean} detected — true when inferred from the address (we then name
     *        the zone so a wrong guess is visible and the buyer can correct it).
     * @returns {{ nextStep: string, prompt: string }}
     */
    static async _advanceAfterZone(session, stepData, zoneChoice, lang, detected = false) {
        stepData.delivery_zone = zoneChoice.zone;
        stepData.delivery_charge = zoneChoice.charge;
        const gateways = await OrderSessionService.getEnabledPaymentGateways(session.shop_id);
        stepData.enabled_gateways = gateways;

        const chargeLine = detected
            ? pickLang(lang,
                `ঠিকানা অনুযায়ী: ${zoneLabel(zoneChoice.zone, lang)}, ডেলিভারি চার্জ ৳${zoneChoice.charge}।`,
                `Based on your address: ${zoneLabel(zoneChoice.zone, lang)}, delivery charge ৳${zoneChoice.charge}.`)
            : pickLang(lang,
                `ডেলিভারি চার্জ ৳${zoneChoice.charge} (${zoneLabel(zoneChoice.zone, lang)})।`,
                `Delivery charge ৳${zoneChoice.charge} (${zoneLabel(zoneChoice.zone, lang)}).`);

        if (gateways.length <= 1) {
            // Only COD → don't ask "select a payment method", it's the sole option.
            stepData.payment_method = gateways[0] || 'cod';
            const ask = pickLang(lang,
                'পেমেন্ট: ক্যাশ অন ডেলিভারি (COD)।\nকোনো বিশেষ নির্দেশনা আছে? (না থাকলে "না" লিখুন)',
                'Payment: Cash on Delivery (COD).\nAny special instructions for your order? (type "no" if none)');
            return { nextStep: 'COLLECTING_NOTES', prompt: `${chargeLine}\n${ask}` };
        }
        // Multiple gateways → ask which. Pass null zoneChoice so buildPaymentPrompt
        // doesn't reprint the charge line we just showed.
        return {
            nextStep: 'COLLECTING_PAYMENT',
            prompt: `${chargeLine}\n` + OrderSessionService.buildPaymentPrompt(gateways, null, lang)
        };
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

        // Sort: cod first, then self-mfs
        const ORDER = ['cod', 'self-mfs'];
        return configs
            .map(c => c.gateway)
            .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    }

    static buildPaymentPrompt(gateways, zoneChoice, lang = 'bn') {
        const chargeNote = zoneChoice
            ? pickLang(lang,
                `ডেলিভারি চার্জ: ৳${zoneChoice.charge} (${zoneLabel(zoneChoice.zone, lang)})\n`,
                `Delivery charge: ৳${zoneChoice.charge} (${zoneLabel(zoneChoice.zone, lang)})\n`)
            : '';
        const lines = gateways.map((gw, i) => `${i + 1}. ${gatewayLabel(gw, lang)}`);
        const header = pickLang(lang, 'পেমেন্ট পদ্ধতি নির্বাচন করুন:', 'Select payment method:');
        return `${chargeNote}${header}\n${lines.join('\n')}`;
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
            'cod':      ['cod', 'cash', 'ক্যাশ', 'cash on delivery'],
            'self-mfs': ['bkash', 'বিকাশ', 'nagad', 'নগদ', 'mfs', 'mobile', 'self-mfs', 'self mfs']
        };

        for (const gw of gateways) {
            if (t === gw) return gw;
            const kws = keywordMap[gw] || [];
            if (kws.some(kw => t.includes(kw))) return gw;
        }

        return null;
    }

    /**
     * Build the shop's order-confirmation closing message (owner thank-you text +
     * the shop's social links). Returns '' when the shop has disabled the closing
     * or has nothing to say. Falls back to the seeded default closing for shops
     * created before this feature (so the thank-you always appears).
     * @param {string} shopId
     * @param {string} language - reply language ('bn' | 'en' | 'mixed')
     * @returns {Promise<string>}
     */
    static async buildShopClosing(shopId, language) {
        const Shop = require('../shop/shop.entity');
        const { buildClosing } = require('../shop/ai-messaging');
        const { DEFAULT_AI_SETTINGS } = require('../shop/shop-defaults');
        const shop = await Shop.findByPk(shopId, { attributes: ['settings'] });
        const settings = shop?.settings || {};
        const closing = settings.ai?.closing || DEFAULT_AI_SETTINGS.closing;
        const socialLinks = settings.businessInfo?.socialLinks || {};
        return buildClosing({ closing, socialLinks, language });
    }

    // ─── Order creation ───────────────────────────────────────────────────────

    /**
     * Convert a completed order session into an Order record.
     * Uses createOrderInternal (no user auth required).
     */
    static async createOrderFromSession(session, stepData) {
        const { createOrderInternal } = getOrderServiceImports();
        const cart = OrderSessionService.getCartItems(session, stepData);

        if (!cart.length) {
            throw new Error('Cannot create order: no product linked to this session');
        }

        const orderData = {
            customer_id: session.customer_id || null,
            customer_name: stepData.name,
            customer_phone: stepData.phone,
            delivery_address: stepData.address,
            delivery_zone: stepData.delivery_zone || null,
            channel: session.channel || 'chatbot',
            // One entry per cart line. price omitted intentionally — the server
            // computes totals from the live catalog price.
            items: cart.map(c => ({
                product_id: c.product_id,
                quantity: c.quantity || 1
            })),
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
    static buildProductSelectionPrompt(candidates, lang = 'bn') {
        const lines = candidates.map((p, i) => {
            const stockNote = p.in_stock === false ? pickLang(lang, ' [স্টক নেই]', ' [Out of stock]') : '';
            const bnName = p.name_bn ? ` (${p.name_bn})` : '';
            return `${i + 1}. ${p.name}${bnName} — ৳${p.price}${stockNote}`;
        });
        const header = pickLang(lang,
            'একাধিক পণ্য পাওয়া গেছে। কোনটি চান তার নম্বর লিখুন:',
            "Multiple products found. Enter the number of the item you'd like to order:");
        return `${header}\n${lines.join('\n')}`;
    }

    static generateStepPrompt(step, stepData, lang) {
        const L = lang || stepData?.language || 'bn';
        const prompts = {
            'SELECTING_PRODUCT':    pickLang(L, 'পণ্য নির্বাচন করুন (নম্বর লিখুন)', 'Select a product (enter a number)'),
            'PRODUCT_CONFIRMATION': pickLang(L, 'আপনি কি এই পণ্যটি অর্ডার করতে চান?', 'Do you want to order this item?'),
            'COLLECTING_QUANTITY':  pickLang(L, 'কয়টা নিবেন?', 'How many would you like?'),
            'ADD_MORE':             pickLang(L, 'আরো কিছু নিতে চান? নাম/ছবি দিন, না হলে "শেষ" লিখুন', 'Add another item? Send a name/photo, or type "done"'),
            'ADDING_PRODUCT':       pickLang(L, 'কোন পণ্যটি যোগ করতে চান? নাম লিখুন বা ছবি পাঠান', 'Which product to add? Send a name or photo'),
            'COLLECTING_NAME':      pickLang(L, 'আপনার নাম কী?', "What's your name?"),
            'COLLECTING_PHONE':     pickLang(L, 'আপনার মোবাইল নম্বর কত?', "What's your mobile number?"),
            'COLLECTING_ADDRESS':   pickLang(L, 'আপনার ডেলিভারির ঠিকানা কি?', "What's your delivery address?"),
            'COLLECTING_ZONE':      pickLang(L, 'আপনার ডেলিভারি এলাকা নির্বাচন করুন', 'Select your delivery area'),
            'COLLECTING_PAYMENT':      pickLang(L, 'পেমেন্ট পদ্ধতি নির্বাচন করুন', 'Select payment method'),
            'AWAITING_MFS_SCREENSHOT': pickLang(L, 'পেমেন্ট স্ক্রিনশট পাঠান', 'Send your payment screenshot'),
            'COLLECTING_NOTES':        pickLang(L, 'কোনো বিশেষ নির্দেশনা আছে?', 'Any special instructions?'),
            'ORDER_SUMMARY':        pickLang(L, 'অর্ডার নিশ্চিত করুন', 'Confirm order')
        };

        return prompts[step] || pickLang(L, 'পরবর্তী ধাপে যান', 'Proceed to next step');
    }

    // ─── Extraction helpers ───────────────────────────────────────────────────

    /**
     * True when the whole message is just a confirmation/acknowledgement word —
     * used to reject such answers where free text is expected (e.g. the name step).
     * Exact equality only; never substring (would reject real names like "Jia").
     */
    static isBareConfirmationWord(text) {
        const BARE_CONFIRMATIONS = new Set([
            'yes', 'y', 'ok', 'okay', 'confirm', 'confirm korun', 'confirm koren',
            'confirm koro', 'order confirm', 'ha', 'haa', 'han', 'hae', 'ji', 'jwi',
            'জি', 'জ্বি', 'হ্যাঁ', 'ঠিক আছে', 'thik ache', 'thik ace', 'acha', 'accha',
            'আচ্ছা', 'done', 'hmm', 'হুম', 'কনফার্ম', 'কনফার্ম করুন'
        ]);
        return BARE_CONFIRMATIONS.has(String(text || '').toLowerCase().trim());
    }

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

    static buildOutOfStockPrompt(reason, productInfo, lang = 'bn') {
        const name = productInfo?.name || pickLang(lang, 'এই পণ্যটি', 'this item');
        return pickLang(lang,
            `দুঃখিত! "${name}" এখন ${reason || 'স্টক আউট'}। 😔\n\n` +
            `আমাদের অন্য পণ্যগুলো দেখতে চান? অথবা অন্য কোনো সাহায্য লাগলে জানান!`,
            `Sorry! "${name}" is currently ${reason || 'out of stock'}. 😔\n\n` +
            `Would you like to see our other products, or can I help you with something else?`);
    }

    // ─── Multi-product cart helpers ───────────────────────────────────────────

    /**
     * The order's line items. The cart (step_data.cart) is the source of truth;
     * for sessions created before multi-product (or any single-item flow) we fall
     * back to a one-item cart built from the last-configured product_info.
     */
    static getCartItems(session, stepData) {
        const cart = stepData?.cart;
        if (Array.isArray(cart) && cart.length) return cart;
        const p = session?.product_info;
        if (p && p.id) {
            return [{
                product_id: p.id,
                name: p.name,
                name_bn: p.name_bn || null,
                price: p.price,
                quantity: p.quantity || 1,
            }];
        }
        return [];
    }

    /** Add-another prompt shown after an item is carted. */
    static buildAddMorePrompt(lastItem, cart, lang) {
        const count = Array.isArray(cart) ? cart.length : 0;
        return pickLang(lang,
            `"${lastItem.name}" কার্টে যোগ হয়েছে ✅ (মোট ${count}টি পণ্য)।\n\n` +
            `আরো কিছু নিতে চান? পণ্যের নাম লিখুন বা ছবি পাঠান।\nআর কিছু না লাগলে "শেষ" লিখুন।`,
            `Added "${lastItem.name}" to your cart ✅ (${count} item${count > 1 ? 's' : ''}).\n\n` +
            `Want to add anything else? Send a product name or photo.\nIf that's all, type "done".`);
    }

    /** Whole-message "finish / no more items" intent at the add-more step. */
    static isCheckoutWord(text) {
        const t = String(text || '').toLowerCase().trim();
        const DONE = new Set([
            'no', 'na', 'nah', 'nope', 'no more', 'done', 'finish', 'finished',
            'checkout', 'check out', 'complete', 'enough', 'bas',
            "that's all", 'thats all', 'shesh', 'sesh', 'sesh koro',
            'শেষ', 'না', 'আর না', 'ar na', 'arna', 'ar lagbe na', 'aro lagbe na', 'বাস', 'হয়ে গেছে',
        ]);
        return DONE.has(t);
    }

    /** Whole-message "yes, add another (but I haven't named it yet)" intent. */
    static isBareAddWord(text) {
        const t = String(text || '').toLowerCase().trim();
        const ADD = new Set([
            'yes', 'y', 'add', 'add more', 'add another', 'more', 'aro', 'aaro',
            'ar', 'ar ekta', 'aro nibo', 'aro lagbe', 'aro chai',
            'আরো', 'আরও', 'হ্যাঁ', 'ha', 'haa', 'han', 'ji', 'জি',
        ]);
        return ADD.has(t);
    }

    /**
     * Identify the next product from a free-text name and/or a photo, reusing the
     * same search + image-match pipeline the session start uses.
     * @returns {Promise<{products: Array, wasFallback: boolean}>}
     */
    static async identifyProduct(shopId, query, rawMessage) {
        const result = await productSearch
            .searchForOrder({ shopId, query, limit: 5 })
            .catch(() => ({ products: [], wasFallback: true }));

        let products = result.products || [];
        let wasFallback = !!result.wasFallback;

        // The dominant F-commerce signal is a product PHOTO — match on the image
        // when text search comes up empty.
        if ((wasFallback || !products.length) && rawMessage?.imageUrl) {
            try {
                const { matchImageMessage } = require('../ai/image-product-matcher.service');
                const imageMatch = await matchImageMessage({ shopId, imageUrl: rawMessage.imageUrl, text: query });
                if (imageMatch.products?.length) {
                    products = imageMatch.products;
                    wasFallback = false;
                }
            } catch (_) { /* image matching is best-effort */ }
        }

        return { products, wasFallback };
    }

    /**
     * Resolve the customer's next-product message into a step transition:
     *   no/unsure match → stay on ADDING_PRODUCT and re-ask
     *   one match       → set product_info, go to COLLECTING_QUANTITY
     *   many matches    → seed candidates, go to SELECTING_PRODUCT
     * Mutates step_data.product_candidates when a picker is needed.
     */
    static async applyNextProduct(session, step_data, answer, rawMessage, lang) {
        const { products, wasFallback } = await OrderSessionService.identifyProduct(session.shop_id, answer, rawMessage);

        if (wasFallback || !products.length) {
            return {
                nextStep: 'ADDING_PRODUCT',
                prompt: pickLang(lang,
                    'এই নামে কোনো পণ্য খুঁজে পাইনি। পণ্যের নাম লিখুন বা ছবি পাঠান, অথবা "শেষ" লিখুন।',
                    'Could not find that product. Send the product name or a photo, or type "done".'),
            };
        }

        if (products.length === 1) {
            const p = products[0];
            const stock = await productSearch.checkStock(p.id, session.shop_id).catch(() => ({ available: true }));
            if (!stock.available) {
                return {
                    nextStep: 'ADDING_PRODUCT',
                    prompt: OrderSessionService.buildOutOfStockPrompt(stock.reason, p, lang),
                };
            }
            const pi = {
                id: p.id,
                name: p.name,
                name_bn: p.name_bn || null,
                price: stock.product?.price ?? p.price,
                quantity: 1,
            };
            await session.update({ product_info: pi });
            session.product_info = pi;
            return {
                nextStep: 'COLLECTING_QUANTITY',
                prompt: pickLang(lang,
                    `"${pi.name}" ✅\n\nকয়টা নিবেন?`,
                    `"${pi.name}" ✅\n\nHow many would you like?`),
            };
        }

        step_data.product_candidates = products.slice(0, 5).map(p => ({
            id: p.id,
            name: p.name,
            name_bn: p.name_bn || null,
            price: p.price,
            in_stock: p.in_stock,
        }));
        return {
            nextStep: 'SELECTING_PRODUCT',
            prompt: OrderSessionService.buildProductSelectionPrompt(step_data.product_candidates, lang),
        };
    }

    // ─── Free-text multi-item parsing ─────────────────────────────────────────

    /**
     * Split a single free-text message into multiple line items, e.g.
     * "2 lawn + 1 dupatta" → [{quantity:2, query:'lawn'}, {quantity:1, query:'dupatta'}].
     * Conservative by design: only splits on explicit "and"-style connectors
     * (never inside a product name) and returns [] for a single item so the
     * existing one-product flow is unchanged. The caller resolves each query and
     * falls back gracefully when a segment doesn't match exactly one product.
     */
    static parseLineItems(text) {
        if (!text || typeof text !== 'string') return [];
        const normalized = text.replace(/[০-৯]/g, (d) => BN_DIGITS[d] || d).trim();
        if (!normalized) return [];
        // Explicit connectors only. Word connectors require surrounding whitespace
        // so they are standalone words, not substrings of a product name. '+', ',',
        // '&', 'and', 'plus', Bengali 'আর', Banglish 'ar'.
        const CONNECTORS = /\s*\+\s*|\s*,\s*|\s*&\s*|\s+and\s+|\s+plus\s+|\s+আর\s+|\s+ar\s+/i;
        const segments = normalized.split(CONNECTORS).map((s) => s.trim()).filter(Boolean);
        if (segments.length < 2) return [];
        const items = [];
        for (const seg of segments) {
            const query = OrderSessionService.stripQuantityTokens(seg);
            if (!query) continue;
            items.push({ quantity: extractQuantity(seg) || 1, query });
        }
        return items.length >= 2 ? items : [];
    }

    /**
     * Strip a LEADING or TRAILING quantity expression from a segment, leaving the
     * product query. Only the ends are touched, so a number-word inside a product
     * name ("Azal Lawn Two Piece") survives. Trailing strips digits only — trailing
     * number-words are rare and would clip names like "Two Piece".
     */
    static stripQuantityTokens(seg) {
        const qw = Object.keys(QTY_WORDS).join('|');
        const unit = '(?:ta|ti|টা|টি|pcs?|pc)';
        let s = String(seg).replace(/[০-৯]/g, (d) => BN_DIGITS[d] || d).trim();
        s = s.replace(new RegExp(`^(?:\\d{1,2}|${qw})(?:\\s*${unit})?\\s+`, 'i'), '');
        s = s.replace(new RegExp(`\\s+\\d{1,2}(?:\\s*${unit})?$`, 'i'), '');
        return s.replace(/\s+/g, ' ').trim();
    }

    /**
     * Resolve a free-text message that may name several products at once and add
     * each resolved, in-stock line to the cart. Falls back to the single-product
     * path when the message isn't multi-item. Mutates step_data.cart.
     */
    static async applyLineItems(session, step_data, answer, rawMessage, lang) {
        const parsed = OrderSessionService.parseLineItems(answer);
        if (parsed.length < 2) {
            return OrderSessionService.applyNextProduct(session, step_data, answer, rawMessage, lang);
        }

        const added = [];
        const unresolved = [];
        for (const { quantity, query } of parsed) {
            const { products, wasFallback } = await OrderSessionService.identifyProduct(session.shop_id, query, null);
            if (wasFallback || products.length !== 1) { unresolved.push(query); continue; }
            const p = products[0];
            const stock = await productSearch.checkStock(p.id, session.shop_id, quantity).catch(() => ({ available: true }));
            if (!stock.available) { unresolved.push(query); continue; }
            const item = {
                product_id: p.id,
                name: p.name,
                name_bn: p.name_bn || null,
                price: stock.product?.price ?? p.price,
                quantity,
            };
            step_data.cart = [...(step_data.cart || []), item];
            added.push(item);
        }

        if (!added.length) {
            // Nothing resolved cleanly — let the single-product path try the whole
            // message (e.g. a multi-word product name that contains "and").
            return OrderSessionService.applyNextProduct(session, step_data, answer, rawMessage, lang);
        }

        const last = added[added.length - 1];
        session.product_info = last;
        await session.update({ product_info: last });
        return {
            nextStep: 'ADD_MORE',
            prompt: OrderSessionService.buildMultiAddPrompt(added, unresolved, step_data.cart, lang),
        };
    }

    /** Add-more prompt after several items were carted in one message. */
    static buildMultiAddPrompt(added, unresolved, cart, lang) {
        const names = added.map((i) => `${i.name} x${i.quantity}`).join(', ');
        const count = Array.isArray(cart) ? cart.length : added.length;
        const missing = (unresolved && unresolved.length)
            ? pickLang(lang,
                `\n("${unresolved.join('", "')}" খুঁজে পাইনি — নাম লিখে আবার চেষ্টা করুন।)`,
                `\n(Couldn't find "${unresolved.join('", "')}" — try its name again.)`)
            : '';
        return pickLang(lang,
            `কার্টে যোগ হয়েছে ✅: ${names} (মোট ${count}টি পণ্য)।${missing}\n\n` +
            `আরো কিছু নিতে চান? নাম লিখুন বা ছবি পাঠান।\nআর কিছু না লাগলে "শেষ" লিখুন।`,
            `Added to your cart ✅: ${names} (${count} item${count > 1 ? 's' : ''}).${missing}\n\n` +
            `Want to add anything else? Send a product name or photo.\nIf that's all, type "done".`);
    }

    // ─── Per-line cart editing (at the summary) ───────────────────────────────

    /**
     * Recognise a per-line cart edit at the summary step. Matches the message
     * against the live cart's product names and returns the action to apply:
     *   { action: 'remove', index }              — drop a line
     *   { action: 'setqty', index, quantity }    — change a line's quantity
     *   { action: null }                         — not an edit (fall through)
     */
    static detectCartEdit(text, cart) {
        const NONE = { action: null };
        if (!text || !Array.isArray(cart) || !cart.length) return NONE;
        const t = String(text).replace(/[০-৯]/g, (d) => BN_DIGITS[d] || d).toLowerCase().trim();

        const idx = OrderSessionService._matchCartLine(t, cart);
        if (idx < 0) return NONE;

        const REMOVE = /\b(remove|delete|cancel|drop|baad|hatao|chai na|lagbe na|lagbena)\b|বাদ|চাই না|লাগবে না|সরাও/i;
        if (REMOVE.test(t)) return { action: 'remove', index: idx };

        const qty = extractQuantity(t);
        if (qty) return { action: 'setqty', index: idx, quantity: qty };
        return NONE;
    }

    /**
     * Index of the cart line a message references, or -1. A line matches when a
     * distinctive (≥3 char) token of its name/name_bn appears in the text. Two
     * lines matching → -1 so we never edit the wrong item.
     */
    static _matchCartLine(text, cart) {
        const tokensOf = (s) => String(s || '')
            .toLowerCase()
            .split(/[^a-z0-9ঀ-৿]+/)
            .filter((w) => w.length >= 3);
        let found = -1;
        for (let i = 0; i < cart.length; i++) {
            const names = [cart[i].name, cart[i].name_bn].filter(Boolean);
            const hit = names.some((n) => tokensOf(n).some((tok) => text.includes(tok)));
            if (hit) {
                if (found >= 0) return -1; // ambiguous
                found = i;
            }
        }
        return found;
    }

    /** Apply a detected cart edit and produce the next step + re-rendered summary. */
    static async applyCartEdit(session, step_data, edit, cart, lang) {
        if (edit.action === 'remove') {
            const newCart = cart.filter((_, i) => i !== edit.index);
            if (!newCart.length) {
                // Removed the last line — the cart is empty; ask what to order next.
                step_data.cart = [];
                session.product_info = null;
                await session.update({ product_info: null });
                return {
                    nextStep: 'ADDING_PRODUCT',
                    prompt: pickLang(lang,
                        'কার্ট এখন খালি। কোন পণ্যটি অর্ডার করতে চান? নাম লিখুন বা ছবি পাঠান।',
                        'Your cart is now empty. Which product would you like to order? Send a name or photo.'),
                    completed: false,
                };
            }
            step_data.cart = newCart;
        } else if (edit.action === 'setqty') {
            step_data.cart = cart.map((c, i) => (i === edit.index ? { ...c, quantity: edit.quantity } : c));
        }
        return {
            nextStep: 'ORDER_SUMMARY',
            prompt: OrderSessionService.generateOrderSummary(session, step_data, lang),
            completed: false,
        };
    }

    // ─── Order summary ────────────────────────────────────────────────────────

    static generateOrderSummary(session, stepData, lang) {
        const L = lang || stepData?.language || 'bn';
        const cart = OrderSessionService.getCartItems(session, stepData);
        const { name, phone, address, delivery_zone, delivery_charge, payment_method, notes } = stepData;
        const zLabel = zoneLabel(delivery_zone, L) || 'N/A';
        const gLabel = gatewayLabel(payment_method, L) || 'N/A';
        const itemsTotal = cart.reduce((s, c) => s + (c.price || 0) * (c.quantity || 1), 0);
        const grandTotal = itemsTotal + (delivery_charge || 0);
        // One line per cart item; product names render the same in both languages.
        const itemLines = (cart.length
            ? cart.map(c => `📦 ${c.name || 'N/A'} x${c.quantity || 1} — ৳${(c.price || 0) * (c.quantity || 1)}`)
            : ['📦 N/A']
        ).join('\n');

        if (L === 'en') {
            return `✅ Order Summary:
${itemLines}
💰 Items: ৳${itemsTotal}
🚚 Delivery: ৳${delivery_charge || 0} (${zLabel})
💳 Payment: ${gLabel}
📍 Address: ${address}
👤 Name: ${name} | 📞 ${phone}
${notes ? `📝 Note: ${notes}\n` : ''}Total: ৳${grandTotal}

Type "YES" to confirm.`;
        }

        return `✅ অর্ডার সারসংক্ষেপ:
${itemLines}
💰 মোট পণ্য: ৳${itemsTotal}
🚚 ডেলিভারি: ৳${delivery_charge || 0} (${zLabel})
💳 পেমেন্ট: ${gLabel}
📍 ঠিকানা: ${address}
👤 নাম: ${name} | 📞 ${phone}
${notes ? `📝 নোট: ${notes}\n` : ''}সর্বমোট: ৳${grandTotal}

নিশ্চিত করতে "YES" লিখুন।`;
    }
}

module.exports = OrderSessionService;
