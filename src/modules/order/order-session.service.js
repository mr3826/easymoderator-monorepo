const { v4: uuidv4 } = require('uuid');
const OrderSession = require('./order-session.entity');
const { Order } = require('./order.entity');
const { Customer } = require('../entities');
const { getShopAiSettings } = require('../shop/shop.service');

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
            automation_mode: aiSettings?.automation_mode || 'DRAFT',
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

            case 'COLLECTING_PAYMENT':
                const payment = this.extractPaymentMethod(answer);
                if (payment) {
                    step_data.payment_method = payment;
                    nextStep = 'COLLECTING_NOTES';
                    prompt = 'কোনো বিশেষ নির্দেশনা আছে? / Any special instructions for your order?';
                } else {
                    prompt = 'অনুগ্রহ করে একটি বৈধ পেমেন্ট পদ্ধতি নির্বাচন করুন। / Please select a valid payment method.';
                }
                break;

            case 'COLLECTING_NOTES':
                step_data.notes = answer.trim() || null;
                nextStep = 'ORDER_SUMMARY';
                prompt = this.generateOrderSummary(session, step_data);
                break;

            case 'ORDER_SUMMARY':
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
            'PRODUCT_CONFIRMATION': 'আপনি কি এই পণ্যটি অর্ডার করতে চান? / Do you want to order this item?',
            'COLLECTING_NAME': 'আপনার নাম কী? / What\'s your name?',
            'COLLECTING_PHONE': 'আপনার মোবাইল নম্বর কত? / What\'s your mobile number?',
            'COLLECTING_ADDRESS': 'আপনার ডেলিভারির ঠিকানা কি? / What\'s your delivery address?',
            'COLLECTING_PAYMENT': 'পেমেন্ট পদ্ধতি নির্বাচন করুন / Select payment method',
            'COLLECTING_NOTES': 'কোনো বিশেষ নির্দেশনা আছে? / Any special instructions?',
            'ORDER_SUMMARY': 'অর্ডার নিশ্চিত করুন / Confirm order'
        };

        return prompts[step] || 'পরবর্তী ধাপে যান / Proceed to next step';
    }

    static extractConfirmation(text) {
        const confirmations = ['yes', 'y', 'হ্যাঁ', 'confirm', 'ok', 'okay', 'ঠিক আছে'];
        const textLower = text.toLowerCase().trim();
        return confirmations.some(conf => textLower.includes(conf));
    }

    static extractPhoneNumber(text) {
        const phoneRegex = /01[3-9]\d{8}/;
        const match = text.match(phoneRegex);
        return match ? match[0] : null;
    }

    static extractPaymentMethod(text) {
        const textLower = text.toLowerCase().trim();
        if (textLower.includes('cod') || textLower.includes('cash') || textLower.includes('ক্যাশ')) {
            return 'COD';
        } else if (textLower.includes('bkash') || textLower.includes('বিকাশ')) {
            return 'bKash';
        } else if (textLower.includes('nagad') || textLower.includes('নগদ')) {
            return 'Nagad';
        }
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

    static async generateOrderNumber(shopId) {
        // Simple order number generation - can be enhanced
        const timestamp = Date.now().toString().slice(-8);
        const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        return `ORD-${timestamp}-${random}`;
    }
}

module.exports = OrderSessionService;
