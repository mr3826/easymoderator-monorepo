const { v4: uuidv4 } = require('uuid');
const OrderSession = require('./order-session.entity');
const { Order } = require('./order.entity');
const { Customer } = require('../entities');
const { getShopAiSettings } = require('../shop/shop.service');
const { getBdSettings, hasSelfMfs } = require('../shop/shop-bd-settings');

// Full Bangladesh mobile number regex (covers 01[3-9]XXXXXXXX with optional +88/88 prefix)
const BD_PHONE_REGEX = /(?:\+?88)?0(1[3-9]\d{8})/;

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
            product_info = null
        } = data;

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

        // Get shop AI settings
        const aiSettings = await getShopAiSettings(shop_id);
        
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
            automation_mode: aiSettings?.automation_mode || 'AUTO',
            confidence_threshold: aiSettings?.confidence_threshold || 60,
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
    static async processStep(sessionId, answer, rawMessage = null) {
        const session = await OrderSession.findOne({
            where: { id: sessionId, status: 'ACTIVE' }
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
        const { current_step, step_data } = session;
        let nextStep = current_step;
        let prompt = '';
        let completed = false;

        switch (current_step) {
            case 'PRODUCT_CONFIRMATION':
                const confirmation = this.extractConfirmation(answer);
                if (confirmation) {
                    nextStep = 'COLLECTING_NAME';
                    prompt = 'আপনার নাম কী? / What\'s your name?';
                } else {
                    prompt = 'পণ্যটি নিশ্চিত করুন। আপনি কি এই পণ্যটি অর্ডার করতে চান? / Please confirm the product. Do you want to order this item?';
                }
                break;

            case 'COLLECTING_NAME':
                const name = answer.trim();
                if (name.length >= 2 && name.length <= 50) {
                    step_data.name = name;
                    nextStep = 'COLLECTING_PHONE';
                    prompt = 'আপনার মোবাইল নম্বর কত? / What\'s your mobile number?';
                } else {
                    prompt = 'অনুগ্রহ করে একটি বৈধ নাম দিন (২-৫০ অক্ষর)। / Please provide a valid name (2-50 characters).';
                }
                break;

            case 'COLLECTING_PHONE':
                const phone = this.extractPhoneNumber(answer);
                if (phone) {
                    step_data.phone = phone;
                    nextStep = 'COLLECTING_ADDRESS';
                    prompt = 'আপনার ডেলিভারির ঠিকানা কি? / What\'s your delivery address?';
                } else {
                    prompt = 'অনুগ্রহ করে একটি বৈধ বাংলাদেশি মোবাইল নম্বর দিন (01xxxxxxxxx)। / Please provide a valid Bangladesh mobile number (01xxxxxxxxx).';
                }
                break;

            case 'COLLECTING_ADDRESS':
                const address = answer.trim();
                if (address.length >= 10) {
                    step_data.address = address;
                    // Check delivery zone (this will be enhanced with RAG)
                    const zoneInfo = await this.checkDeliveryZone(session.shop_id, address);
                    step_data.delivery_zone = zoneInfo.zone;
                    step_data.delivery_charge = zoneInfo.charge;
                    
                    if (zoneInfo.zone) {
                        nextStep = 'COLLECTING_PAYMENT';
                        prompt = `ডেলিভারি চার্জ: ৳${zoneInfo.charge} (${zoneInfo.zone})। পেমেন্ট পদ্ধতি নির্বাচন করুন:\n1. ক্যাশ অন ডেলিভারি (COD)\n2. bKash\n3. Nagad\n\nDelivery charge: ৳${zoneInfo.charge} (${zoneInfo.zone}). Please select payment method:\n1. Cash on Delivery (COD)\n2. bKash\n3. Nagad`;
                    } else {
                        prompt = 'দুঃখিত, আপনার এলাকায় ডেলিভারি সেবা নেই। অনুগ্রহ করে আপনার ঠিকানা আবার পরীক্ষা করুন। / Sorry, we don\'t deliver to your area. Please check your address again.';
                    }
                } else {
                    prompt = 'অনুগ্রহ করে একটি সম্পূর্ণ ঠিকানা দিন (ন্যূনতম ১০ অক্ষর)। / Please provide a complete address (minimum 10 characters).';
                }
                break;

            case 'COLLECTING_PAYMENT': {
                const smartPaymentService = require('../payment/smart-payment-detection.service');
                const paymentOptions = await smartPaymentService.getAvailablePaymentOptions(session.shop_id, 'bn');
                
                // Skip payment step if only COD is available
                if (paymentOptions.shouldSkipPayment) {
                    step_data.payment_method = 'cod';
                    nextStep = 'COLLECTING_NOTES';
                    prompt = 'কোনো বিশেষ নির্দেশনা আছে? / Any special instructions?';
                } else {
                    // Show available payment options
                    const payment = smartPaymentService.extractPaymentMethod(
                        answer, 
                        paymentOptions.availableMethods, 
                        paymentOptions.paymentOptions.methodDetails
                    );
                    
                    if (payment) {
                        step_data.payment_method = payment;
                        
                        // Get processing details for the selected method
                        const methodDetails = smartPaymentService.getPaymentMethodDetails(session.shop_id, payment);
                        
                        if (methodDetails.processingType === 'merchant_api') {
                            // Merchant API payment flow
                            nextStep = 'AWAITING_ONLINE_PAYMENT';
                            prompt = `পেমেন্ট লিংক তৈরি হচ্ছি... অনুগ্রহ করে অপেক্ষা করুন।\n\nCreating payment link... Please wait.`;
                            
                            // Initiate payment in background
                            setTimeout(async () => {
                                await this.initiateMerchantPayment(session, payment);
                            }, 1000);
                            
                        } else if (methodDetails.processingType === 'owner_verification') {
                            // Self-MFS payment flow
                            const bdSettings = await getBdSettings(session.shop_id);
                            if (hasSelfMfs(bdSettings)) {
                                step_data.expected_mfs_number = bdSettings.mfs_number;
                                step_data.expected_mfs_type = bdSettings.mfs_type;
                                nextStep = 'AWAITING_SELF_MFS_PAYMENT';
                                prompt = `${bdSettings.mfs_type === 'nagad' ? 'নগদ' : 'বিকাশ'} নম্বর: ${bdSettings.mfs_number}\n\nউপরের নম্বরে পেমেন্ট পাঠিয়ে ট্রানজেকশন ID বা স্ক্রিনশট দিন।\n\nSend payment to the number above and share transaction ID or screenshot.`;
                            } else {
                                nextStep = 'COLLECTING_NOTES';
                                prompt = 'কোনো বিশেষ নির্দেশনা আছে? / Any special instructions?';
                            }
                        } else if (methodDetails.processingType === 'gateway_api') {
                            // Gateway API payment (AamarPay, SSLCommerz)
                            nextStep = 'AWAITING_ONLINE_PAYMENT';
                            prompt = `পেমেন্ট লিংক তৈরি হচ্ছি... অনুগ্রহ করে অপেক্ষা করুন।\n\nCreating payment link... Please wait.`;
                            
                            // Initiate payment in background
                            setTimeout(async () => {
                                await this.initiateGatewayPayment(session, payment);
                            }, 1000);
                        } else {
                            // COD payment
                            nextStep = 'COLLECTING_NOTES';
                            prompt = 'কোনো বিশেষ নির্দেশনা আছে? / Any special instructions?';
                        }
                    } else {
                        // Show payment options if this is first time in this step
                        if (!step_data.payment_options_shown) {
                            step_data.payment_options_shown = true;
                            step_data.available_payment_methods = paymentOptions.availableMethods;
                            step_data.payment_method_details = paymentOptions.paymentOptions.methodDetails;
                            prompt = paymentOptions.paymentPrompt || 'অনুগ্রহ করে একটি বৈধ পেমেন্ট পদ্ধতি নির্বাচন করুন। / Please select a valid payment method.';
                        } else {
                            prompt = 'অনুগ্রহ করে একটি বৈধ পেমেন্ট পদ্ধতি নির্বাচন করুন। / Please select a valid payment method.';
                        }
                    }
                }
                break;
            }

            case 'AWAITING_ONLINE_PAYMENT': {
                // Payment is being processed by merchant API
                if (step_data.payment_status === 'completed') {
                    nextStep = 'COLLECTING_NOTES';
                    prompt = 'পেমেন্ট সফলভাবে সম্পন্ন হয়েছে ✅। কোনো বিশেষ নির্দেশনা আছে? / Payment completed successfully ✅. Any special instructions?';
                } else if (step_data.payment_status === 'failed') {
                    nextStep = 'COLLECTING_PAYMENT';
                    prompt = 'পেমেন্ট ব্যর্থ হয়েছে। অন্য পেমেন্ট পদ্ধতি নির্বাচন করুন। / Payment failed. Please select another payment method.';
                } else {
                    prompt = 'পেমেন্ট প্রক্রিয়াধীন... অনুগ্রহ করে অপেক্ষা করুন। / Payment processing... Please wait.';
                }
                break;
            }

            case 'AWAITING_SELF_MFS_PAYMENT': {
                // Self-MFS payment confirmation
                if (step_data.mfs_payment_verified) {
                    nextStep = 'COLLECTING_NOTES';
                    prompt = 'পেমেন্ট নিশ্চিত হয়েছে ✅। কোনো বিশেষ নির্দেশনা আছে? / Payment confirmed ✅. Any special instructions?';
                } else if (step_data.owner_notification_sent) {
                    prompt = 'পেমেন্ট যাচাই করা হচ্ছে... অনুগ্রহ করে অপেক্ষা করুন। / Verifying payment... Please wait.';
                } else {
                    prompt = `${step_data.expected_mfs_type === 'nagad' ? 'নগদ' : 'বিকাশ'} ট্রানজেকশন ID বা স্ক্রিনশটটি পাঠান। / Please send the ${step_data.expected_mfs_type || 'MFS'} transaction ID or screenshot.`;
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
                    // Create the order
                    const order = await this.createOrder(session, step_data);
                    await session.update({
                        status: 'COMPLETED',
                        created_order_id: order.id,
                        final_summary: this.generateOrderSummary(session, step_data)
                    });
                    completed = true;
                    prompt = `অর্ডার সফলভাবে সম্পন্ন হয়েছে! অর্ডার নম্বর: ${order.order_number}\n\nOrder completed successfully! Order number: ${order.order_number}`;
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
    static async getSessionState(sessionId) {
        const session = await OrderSession.findOne({
            where: { id: sessionId }
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
    static async cancelSession(sessionId) {
        const session = await OrderSession.findOne({
            where: { id: sessionId }
        });

        if (!session) {
            throw new Error('Session not found');
        }

        await session.update({ status: 'CANCELLED' });
        return { success: true };
    }

    /**
     * Helper methods
     */
    static generateStepPrompt(step, stepData) {
        const prompts = {
            'PRODUCT_CONFIRMATION':    'আপনি কি এই পণ্যটি অর্ডার করতে চান? / Do you want to order this item?',
            'COLLECTING_NAME':         'আপনার নাম কী? / What\'s your name?',
            'COLLECTING_PHONE':        'আপনার মোবাইল নম্বর কত? / What\'s your mobile number?',
            'COLLECTING_ADDRESS':      'আপনার ডেলিভারির ঠিকানা কি? / What\'s your delivery address?',
            'COLLECTING_PAYMENT':      'পেমেন্ট পদ্ধতি: ১. COD  ২. বিকাশ  ৩. নগদ / Payment: 1. COD  2. bKash  3. Nagad',
            'AWAITING_ONLINE_PAYMENT': 'পেমেন্ট প্রক্রিয়াধীন... / Payment processing...',
            'AWAITING_SELF_MFS_PAYMENT': 'পেমেন্ট যাচাই হচ্ছে... / Verifying payment...',
            'COLLECTING_NOTES':        'কোনো বিশেষ নির্দেশনা আছে? / Any special instructions?',
            'ORDER_SUMMARY':           'অর্ডার নিশ্চিত করুন / Confirm order'
        };

        return prompts[step] || 'পরবর্তী ধাপে যান / Proceed to next step';
    }

    static async generateOrderNumber(shopId) {
        // Use the order service's generateOrderNumber function
        const { generateOrderNumber } = require('./order.service');
        return await generateOrderNumber(shopId);
    }

    static extractConfirmation(text) {
        const confirmations = ['yes', 'y', 'হ্যাঁ', 'confirm', 'ok', 'okay', 'ঠিক আছে'];
        const textLower = text.toLowerCase().trim();
        return confirmations.some(conf => textLower.includes(conf));
    }

    static extractPhoneNumber(text) {
        const match = text.match(BD_PHONE_REGEX);
        if (!match) return null;
        // Normalise to 11-digit local format (strip +88/88 prefix)
        return `0${match[1]}`;
    }

    static extractPaymentMethod(text) {
        const t = text.toLowerCase().trim();
        if (/\b(cod|cash\s+on\s+delivery|ক্যাশ|cash)\b/.test(t)) return 'COD';
        if (/\b(bkash|বিকাশ|bikash)\b/.test(t) || t === '2') return 'bKash';
        if (/\b(nagad|নগদ)\b/.test(t) || t === '3') return 'Nagad';
        if (/\b(rocket|রকেট|dutch[\s-]?bangla)\b/.test(t) || t === '4') return 'Rocket';
        // Numeric shortcut: "1" = COD
        if (t === '1') return 'COD';
        return null;
    }

    static async checkDeliveryZone(shopId, address) {
        // TODO: Implement RAG-based delivery zone matching
        // For now, return default values
        return {
            zone: 'Dhaka Inside',
            charge: 60
        };
    }

    static generateOrderSummary(session, stepData) {
        const product = session.product_info;
        const { name, phone, address, delivery_charge, payment_method, notes } = stepData;
        
        return `✅ অর্ডার সারসংক্ষেপ:
📦 পণ্য: ${product?.name || 'N/A'} x${product?.quantity || 1}
💰 মূল্য: ৳${product?.price || 0}
🚚 ডেলিভারি: ৳${delivery_charge || 0}
💳 পেমেন্ট: ${payment_method}
📍 ঠিকানা: ${address}
👤 নাম: ${name} | 📞 ${phone}

সর্বমোট: ৳${(product?.price || 0) + (delivery_charge || 0)}

নিশ্চিত করতে "YES" লিখুন।

---

✅ Order Summary:
📦 Product: ${product?.name || 'N/A'} x${product?.quantity || 1}
💰 Price: ৳${product?.price || 0}
🚚 Delivery: ৳${delivery_charge || 0}
💳 Payment: ${payment_method}
📍 Address: ${address}
👤 Name: ${name} | 📞 ${phone}

Total: ৳${(product?.price || 0) + (delivery_charge || 0)}

Type "YES" to confirm.`;
    }

    static async createOrder(session, stepData) {
        const orderData = {
            shop_id: session.shop_id,
            customer_id: session.customer_id,
            customer_name: stepData.name,
            customer_phone: stepData.phone,
            order_number: await this.generateOrderNumber(session.shop_id),
            channel: session.channel,
            items: [session.product_info],
            order_status: session.automation_mode === 'FULL_AUTO' ? 'confirmed' : 'draft',
            subtotal: session.product_info?.price || 0,
            delivery_fee: stepData.delivery_charge || 0,
            delivery_address: stepData.address,
            delivery_zone: stepData.delivery_zone,
            total: (session.product_info?.price || 0) + (stepData.delivery_charge || 0),
            payment_method: stepData.payment_method,
            note: stepData.notes
        };

        return await Order.create(orderData);
    }

    /**
     * Initiate gateway API payment (reserved for future gateway integrations)
     */
    static async initiateGatewayPayment(session, paymentMethod) {
        try {
            const paymentResult = null; // No online gateway active — contact us for integration

            if (paymentResult?.success) {
                // Update session with payment info
                await session.update({
                    step_data: {
                        ...session.step_data,
                        payment_id: paymentResult.paymentId,
                        payment_url: paymentResult.paymentUrl,
                        payment_status: 'initiated'
                    }
                });

                // Send payment URL to customer
                const webhookService = require('../webhook/webhook.service');
                const { Channel } = require('../entities');
                const channel = await Channel.findOne({
                    where: {
                        shop_id: session.shop_id,
                        is_active: true
                    },
                    order: [['created_at', 'DESC']]
                });

                if (channel) {
                    const paymentMessage = `💳 পেমেন্ট লিংক তৈরি হয়েছে!\n\nপেমেন্ট করতে নিচের লিংকে ক্লিক করুন:\n${paymentResult.paymentUrl}\n\nপরিমাণ: ৳${orderData.total}\nঅর্ডার: #${orderData.order_number}\n\nলিংকটি ১০ মিনিটের মধ্যে ব্যবহার করুন।\n\n---\n\n💳 Payment link created!\n\nClick the link below to pay:\n${paymentResult.paymentUrl}\n\nAmount: ৳${orderData.total}\nOrder: #${orderData.order_number}\n\nUse the link within 10 minutes.`;
                    
                    await webhookService.sendMessage(channel, session.customer_channel_id, paymentMessage);
                }
            }

        } catch (error) {
            console.error('Failed to initiate gateway payment:', error);
            // Update session to show payment failed
            await session.update({
                step_data: {
                    ...session.step_data,
                    payment_status: 'failed'
                }
            });
        }
    }
    static async initiateMerchantPayment(session, paymentMethod) {
        try {
            // Prepare order data for payment
            const orderData = {
                id: session.id, // Use session ID as temporary order ID
                order_number: await this.generateOrderNumber(session.shop_id),
                customer_name: session.step_data.name,
                customer_phone: session.step_data.phone,
                total: (session.product_info?.price || 0) + (session.step_data.delivery_charge || 0),
                shop_id: session.shop_id
            };

            let paymentResult;
            
            if (paymentMethod === 'bKash') {
                const bkashService = require('../payment/bkash-merchant.service');
                paymentResult = await bkashService.createPayment(session.shop_id, orderData);
            }

            if (paymentResult?.success) {
                // Update session with payment info
                await session.update({
                    step_data: {
                        ...session.step_data,
                        payment_id: paymentResult.paymentId,
                        payment_url: paymentResult.paymentUrl,
                        payment_status: 'initiated'
                    }
                });

                // Send payment URL to customer
                const webhookService = require('../webhook/webhook.service');
                const channel = await Channel.findOne({
                    where: {
                        shop_id: session.shop_id,
                        is_active: true
                    },
                    order: [['created_at', 'DESC']]
                });

                if (channel) {
                    const paymentMessage = `💳 পেমেন্ট লিংক তৈরি হয়েছে!\n\nপেমেন্ট করতে নিচের লিংকে ক্লিক করুন:\n${paymentResult.paymentUrl}\n\nপরিমাণ: ৳${orderData.total}\nঅর্ডার: #${orderData.order_number}\n\nলিংকটি ১০ মিনিটের মধ্যে ব্যবহার করুন।\n\n---\n\n💳 Payment link created!\n\nClick the link below to pay:\n${paymentResult.paymentUrl}\n\nAmount: ৳${orderData.total}\nOrder: #${orderData.order_number}\n\nUse the link within 10 minutes.`;
                    
                    await webhookService.sendMessage(channel, session.customer_channel_id, paymentMessage);
                }
            }

        } catch (error) {
            console.error('Failed to initiate merchant payment:', error);
            // Update session to show payment failed
            await session.update({
                step_data: {
                    ...session.step_data,
                    payment_status: 'failed'
                }
            });
        }
    }

    /**
     * Handle self-MFS payment confirmation
     */
    static async handleSelfMfsPayment(session, paymentInfo) {
        try {
            const ownerNotificationService = require('../notification/owner-notification.service');
            
            // Send notification to shop owner
            const notificationResult = await ownerNotificationService.sendPaymentConfirmationRequest(
                session.shop_id,
                {
                    id: session.id,
                    order_number: await this.generateOrderNumber(session.shop_id),
                    customer_name: session.step_data.name,
                    customer_phone: session.step_data.phone,
                    total: (session.product_info?.price || 0) + (session.step_data.delivery_charge || 0)
                },
                {
                    paymentMethod: session.step_data.expected_mfs_type,
                    transactionId: paymentInfo.transactionId,
                    customerMessage: paymentInfo.message,
                    screenshotUrl: paymentInfo.screenshotUrl
                }
            );

            if (notificationResult.success) {
                // Update session
                await session.update({
                    step_data: {
                        ...session.step_data,
                        owner_notification_sent: true,
                        owner_notification_id: notificationResult.notificationId,
                        payment_info: paymentInfo
                    }
                });
            }

        } catch (error) {
            console.error('Failed to handle self-MFS payment:', error);
        }
    }

    /**
     * Verify payment status (for merchant API payments)
     */
    static async verifyPaymentStatus(session) {
        try {
            const { payment_id, payment_method } = session.step_data;
            
            if (!payment_id || !payment_method) {
                return { verified: false };
            }

            let paymentResult;
            
            if (payment_method === 'bKash') {
                const bkashService = require('../payment/bkash-merchant.service');
                paymentResult = await bkashService.queryPaymentStatus(session.shop_id, payment_id);
            }

            if (paymentResult?.success && paymentResult.status === 'Completed') {
                // Update session with payment success
                await session.update({
                    step_data: {
                        ...session.step_data,
                        payment_status: 'completed',
                        payment_verified_at: new Date()
                    }
                });

                return { verified: true, paymentResult };
            }

            return { verified: false };

        } catch (error) {
            console.error('Failed to verify payment status:', error);
            return { verified: false };
        }
    }

    /**
     * Auto-confirm order when payment is verified
     */
    static async autoConfirmOrder(session) {
        try {
            const orderData = {
                shop_id: session.shop_id,
                customer_id: session.customer_id,
                customer_name: session.step_data.name,
                customer_phone: session.step_data.phone,
                order_number: await this.generateOrderNumber(session.shop_id),
                channel: session.channel,
                items: [session.product_info],
                order_status: 'confirmed',
                payment_status: 'paid',
                fulfillment_status: 'unfulfilled',
                subtotal: session.product_info?.price || 0,
                delivery_fee: session.step_data.delivery_charge || 0,
                delivery_address: session.step_data.address,
                delivery_zone: session.step_data.delivery_zone,
                total: (session.product_info?.price || 0) + (session.step_data.delivery_charge || 0),
                payment_method: session.step_data.payment_method,
                note: session.step_data.notes,
                paid_at: new Date(),
                auto_confirmed: true
            };

            // Create order using internal method
            const { createOrderInternal } = require('./order.service');
            const order = await createOrderInternal(session.shop_id, orderData);

            // Update session
            await session.update({
                status: 'COMPLETED',
                created_order_id: order.id,
                final_summary: this.generateOrderSummary(session, session.step_data)
            });

            // Trigger invoice generation and delivery booking
            await this.triggerOrderFulfillment(order, session);

            return order;

        } catch (error) {
            console.error('Failed to auto-confirm order:', error);
            throw error;
        }
    }

    /**
     * Trigger invoice generation and delivery booking
     */
    static async triggerOrderFulfillment(order, session) {
        try {
            // Generate invoice
            const invoiceService = require('../invoice/invoice.service');
            await invoiceService.generateInvoice(order);

            // Book delivery if delivery provider is configured
            const deliveryService = require('../delivery/delivery.service');
            const activeProvider = await deliveryService.getActiveProvider(session.shop_id);
            
            if (activeProvider && order.total > 0) {
                const deliveryPayload = {
                    order_number: order.order_number,
                    customer_name: order.customer_name,
                    customer_phone: order.customer_phone,
                    delivery_address: order.delivery_address,
                    total: parseFloat(order.total),
                    note: order.note,
                    item_quantity: 1,
                    item_weight: 0.5,
                    item_description: `Order ${order.order_number}`,
                    delivery_type: 48
                };

                await deliveryService.createDeliveryOrder(session.shop_id, deliveryPayload);
            }

        } catch (error) {
            console.error('Failed to trigger order fulfillment:', error);
            // Don't throw - order is already created
        }
    }
}

module.exports = OrderSessionService;
