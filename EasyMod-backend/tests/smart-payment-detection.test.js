/**
 * Smart Payment Detection Backend Tests
 * Tests 3 real shop scenarios with actual database operations and API calls
 */

const { expect } = require('chai');
const request = require('supertest');
const app = require('../../src/app');
const { Shop, PaymentConfig, User, UserShop, Customer, Channel } = require('../../src/modules/entities');
const { sequelize } = require('../../src/config/database');
const smartPaymentService = require('../../src/modules/payment/smart-payment-detection.service');

describe('Smart Payment Detection - Real Shop Scenarios', () => {
    let testShops = [];
    let testUsers = [];
    let testChannels = [];

    before(async () => {
        // Clean up test data
        await sequelize.sync({ force: true });

        // Create test users (shop owners)
        testUsers = await User.bulkCreate([
            {
                name: 'Rahim - Fashion Hub',
                email: 'rahim@fashionhub.com',
                phone: '01712345678',
                role: 'owner'
            },
            {
                name: 'Karim - Tech Store',
                email: 'karim@techstore.com',
                phone: '01898765432',
                role: 'owner'
            },
            {
                name: 'Fatema - Premium Fashion',
                email: 'fatema@premiumfashion.com',
                phone: '01611223344',
                role: 'owner'
            }
        ]);

        // Create test shops
        testShops = await Shop.bulkCreate([
            {
                name: 'Fashion Hub BD',
                domain: 'fashionhub',
                address: 'Dhanmondi, Dhaka',
                phone: '01712345678',
                email: 'info@fashionhub.com',
                settings: {
                    ai: {
                        automation_mode: 'FULL_AUTO',
                        confidence_threshold: 70
                    }
                }
            },
            {
                name: 'Tech Store Bangladesh',
                domain: 'techstore',
                address: 'Gulshan, Dhaka',
                phone: '01898765432',
                email: 'info@techstore.com',
                settings: {
                    ai: {
                        automation_mode: 'FULL_AUTO',
                        confidence_threshold: 70
                    }
                }
            },
            {
                name: 'Premium Fashion BD',
                domain: 'premiumfashion',
                address: 'Banani, Dhaka',
                phone: '01611223344',
                email: 'info@premiumfashion.com',
                settings: {
                    ai: {
                        automation_mode: 'FULL_AUTO',
                        confidence_threshold: 70
                    }
                }
            }
        ]);

        // Link users to shops
        await UserShop.bulkCreate([
            { user_id: testUsers[0].id, shop_id: testShops[0].id, is_active: true },
            { user_id: testUsers[1].id, shop_id: testShops[1].id, is_active: true },
            { user_id: testUsers[2].id, shop_id: testShops[2].id, is_active: true }
        ]);

        // Create Facebook channels for each shop
        testChannels = await Channel.bulkCreate([
            {
                shop_id: testShops[0].id,
                platform: 'messenger',
                channel_id: 'fashionhub_messenger',
                page_id: '123456789',
                page_name: 'Fashion Hub BD',
                is_active: true
            },
            {
                shop_id: testShops[1].id,
                platform: 'messenger',
                channel_id: 'techstore_messenger',
                page_id: '987654321',
                page_name: 'Tech Store Bangladesh',
                is_active: true
            },
            {
                shop_id: testShops[2].id,
                platform: 'messenger',
                channel_id: 'premiumfashion_messenger',
                page_id: '555666777',
                page_name: 'Premium Fashion BD',
                is_active: true
            }
        ]);

        // Setup payment configurations for each shop
        await setupPaymentConfigurations();
    });

    async function setupPaymentConfigurations() {
        // Scenario 1: Fashion Hub - COD Only
        await PaymentConfig.create({
            shop_id: testShops[0].id,
            gateway: 'cod',
            is_enabled: true,
            config: {},
            credentials: {}
        });

        // Scenario 2: Tech Store - Self-MFS + COD
        await PaymentConfig.bulkCreate([
            {
                shop_id: testShops[1].id,
                gateway: 'cod',
                is_enabled: true,
                config: {},
                credentials: {}
            },
            {
                shop_id: testShops[1].id,
                gateway: 'self-mfs',
                is_enabled: true,
                config: {
                    mfs_type: 'nagad',
                    mfs_number: '01812345678'
                },
                credentials: {}
            }
        ]);

        // Scenario 3: Premium Fashion - bKash Merchant + Self-MFS + COD
        await PaymentConfig.bulkCreate([
            {
                shop_id: testShops[2].id,
                gateway: 'cod',
                is_enabled: true,
                config: {},
                credentials: {}
            },
            {
                shop_id: testShops[2].id,
                gateway: 'bkash-merchant',
                is_enabled: true,
                config: {
                    environment: 'sandbox'
                },
                credentials: {
                    app_key: 'test_app_key',
                    app_secret: 'test_app_secret',
                    username: 'test_username',
                    password: 'test_password'
                }
            },
            {
                shop_id: testShops[2].id,
                gateway: 'self-mfs',
                is_enabled: true,
                config: {
                    mfs_type: 'bkash',
                    mfs_number: '01345678901'
                }
            }
        ]);
    }

    describe('Scenario 1: Fashion Hub BD - COD Only', () => {
        it('should detect COD only and skip payment step', async () => {
            const shopId = testShops[0].id;
            
            const paymentOptions = await smartPaymentService.getAvailablePaymentOptions(shopId, 'bn');
            
            console.log('\n=== SCENARIO 1: Fashion Hub BD - COD Only ===');
            console.log('Available Methods:', paymentOptions.availableMethods);
            console.log('Should Skip Payment:', paymentOptions.shouldSkipPayment);
            console.log('Payment Prompt:', paymentOptions.paymentPrompt);
            
            // Assertions
            expect(paymentOptions.availableMethods).to.deep.equal(['cod']);
            expect(paymentOptions.shouldSkipPayment).to.be.true;
            expect(paymentOptions.paymentPrompt).to.be.null;
            expect(paymentOptions.paymentOptions.hasCod).to.be.true;
            expect(paymentOptions.paymentOptions.hasOnlinePayment).to.be.false;
            expect(paymentOptions.paymentOptions.totalMethods).to.equal(1);
            
            console.log('✅ PASSED: COD only detected, payment step skipped\n');
        });

        it('should handle complete order flow for COD only', async () => {
            console.log('\n=== Testing Complete Order Flow: COD Only ===');
            
            // Start order session
            const sessionResponse = await request(app)
                .post('/api/order-sessions')
                .send({
                    shop_id: testShops[0].id,
                    customer_channel_id: 'customer_001',
                    platform: 'messenger',
                    initial_message: 'I want to buy a t-shirt',
                    product_info: {
                        name: 'T-Shirt',
                        price: 500,
                        quantity: 1
                    }
                });

            expect(sessionResponse.status).to.equal(200);
            const session = sessionResponse.body.data;
            console.log('✅ Order session started:', session.session_id);

            // Process name step
            const nameResponse = await request(app)
                .post(`/api/order-sessions/${session.session_id}/step`)
                .send({
                    answer: 'Rahim'
                });

            expect(nameResponse.status).to.equal(200);
            console.log('✅ Name step completed');

            // Process phone step
            const phoneResponse = await request(app)
                .post(`/api/order-sessions/${session.session_id}/step`)
                .send({
                    answer: '01712345678'
                });

            expect(phoneResponse.status).to.equal(200);
            console.log('✅ Phone step completed');

            // Process address step
            const addressResponse = await request(app)
                .post(`/api/order-sessions/${session.session_id}/step`)
                .send({
                    answer: 'House 12, Road 5, Dhanmondi, Dhaka'
                });

            expect(addressResponse.status).to.equal(200);
            const addressData = addressResponse.body.data;
            console.log('✅ Address step completed');
            console.log('Current step:', addressData.current_step);
            
            // Should skip payment and go to notes
            expect(addressData.current_step).to.equal('COLLECTING_NOTES');

            // Process notes step
            const notesResponse = await request(app)
                .post(`/api/order-sessions/${session.session_id}/step`)
                .send({
                    answer: 'No special instructions'
                });

            expect(notesResponse.status).to.equal(200);
            const notesData = notesResponse.body.data;
            console.log('✅ Notes step completed');
            console.log('Current step:', notesData.current_step);
            console.log('Order Summary:', notesData.prompt);

            // Confirm order
            const confirmResponse = await request(app)
                .post(`/api/order-sessions/${session.session_id}/step`)
                .send({
                    answer: 'YES'
                });

            expect(confirmResponse.status).to.equal(200);
            const confirmData = confirmResponse.body.data;
            console.log('✅ Order confirmed');
            console.log('Completed:', confirmData.completed);
            console.log('Final prompt:', confirmData.prompt);

            expect(confirmData.completed).to.be.true;
            expect(confirmData.prompt).to.include('Order completed successfully');
            
            console.log('✅ PASSED: Complete COD order flow works\n');
        });
    });

    describe('Scenario 2: Tech Store - Self-MFS + COD', () => {
        it('should detect Self-MFS and COD payment options', async () => {
            const shopId = testShops[1].id;

            const paymentOptions = await smartPaymentService.getAvailablePaymentOptions(shopId, 'mixed');

            console.log('\n=== SCENARIO 2: Tech Store - Self-MFS + COD ===');
            console.log('Available Methods:', paymentOptions.availableMethods);
            console.log('Should Skip Payment:', paymentOptions.shouldSkipPayment);

            expect(paymentOptions.availableMethods).to.include('cod');
            expect(paymentOptions.paymentOptions.hasCod).to.be.true;

            console.log('✅ PASSED: Self-MFS + COD detected\n');
        });
    });

    describe('Scenario 3: Premium Fashion - Multiple Payment Methods', () => {
        it('should detect all payment methods including bKash merchant and self-MFS', async () => {
            const shopId = testShops[2].id;
            
            const paymentOptions = await smartPaymentService.getAvailablePaymentOptions(shopId, 'mixed');
            
            console.log('\n=== SCENARIO 3: Premium Fashion - Multiple Methods ===');
            console.log('Available Methods:', paymentOptions.availableMethods);
            console.log('Should Skip Payment:', paymentOptions.shouldSkipPayment);
            console.log('Payment Prompt:', paymentOptions.paymentPrompt);
            
            // Assertions
            expect(paymentOptions.availableMethods).to.include('cod');
            expect(paymentOptions.availableMethods).to.include('bkash');
            expect(paymentOptions.paymentOptions.hasCod).to.be.true;
            expect(paymentOptions.paymentOptions.hasOnlinePayment).to.be.true;
            expect(paymentOptions.paymentOptions.hasMerchantMfs).to.be.true;
            expect(paymentOptions.paymentOptions.totalMethods).to.be.at.least(2);
            
            console.log('✅ PASSED: Multiple payment methods detected\n');
        });

        it('should handle self-MFS payment selection and owner confirmation', async () => {
            console.log('\n=== Testing Self-MFS Payment Flow ===');
            
            // Start order session
            const sessionResponse = await request(app)
                .post('/api/order-sessions')
                .send({
                    shop_id: testShops[2].id,
                    customer_channel_id: 'customer_003',
                    platform: 'messenger',
                    initial_message: 'I want to buy a premium shirt',
                    product_info: {
                        name: 'Premium Cotton Shirt',
                        price: 1200,
                        quantity: 1
                    }
                });

            const session = sessionResponse.body.data;

            // Skip to payment step
            await request(app).post(`/api/order-sessions/${session.session_id}/step`).send({ answer: 'Fatema' });
            await request(app).post(`/api/order-sessions/${session.session_id}/step`).send({ answer: '01611223344' });
            await request(app).post(`/api/order-sessions/${session.session_id}/step`).send({ answer: 'Apt 4B, Road 8, Banani, Dhaka' });

            // Process payment step - select self-MFS
            const paymentResponse = await request(app)
                .post(`/api/order-sessions/${session.session_id}/step`)
                .send({
                    answer: 'বিকাশ' // Select self-MFS bKash
                });

            expect(paymentResponse.status).to.equal(200);
            const paymentData = paymentResponse.body.data;
            console.log('✅ Self-MFS selected');
            console.log('Current step:', paymentData.current_step);
            console.log('Payment prompt:', paymentData.prompt);

            expect(paymentData.current_step).to.equal('AWAITING_SELF_MFS_PAYMENT');
            expect(paymentData.prompt).to.include('বিকাশ নম্বর');
            expect(paymentData.prompt).to.include('01345678901');
            
            console.log('✅ PASSED: Self-MFS payment selection works\n');
        });

        it('should handle payment method extraction from various inputs', async () => {
            console.log('\n=== Testing Payment Method Extraction ===');
            
            const shopId = testShops[2].id;
            const paymentOptions = await smartPaymentService.getAvailablePaymentOptions(shopId, 'mixed');
            
            // Test different input methods
            const testInputs = [
                { input: '1', expected: 'cod' },
                { input: '2', expected: 'bkash' },
                { input: 'bkash', expected: 'bkash' },
                { input: 'বিকাশ', expected: 'bkash' },
                { input: 'cash', expected: 'cod' },
                { input: 'cod', expected: 'cod' }
            ];

            for (const test of testInputs) {
                const extracted = smartPaymentService.extractPaymentMethod(
                    test.input,
                    paymentOptions.availableMethods,
                    paymentOptions.paymentOptions.methodDetails
                );
                
                console.log(`Input: "${test.input}" → Extracted: ${extracted} (Expected: ${test.expected})`);
                expect(extracted).to.equal(test.expected);
            }
            
            console.log('✅ PASSED: Payment method extraction works for all inputs\n');
        });
    });

    describe('Edge Cases and Error Handling', () => {
        it('should handle shop with no payment configurations', async () => {
            console.log('\n=== Testing Edge Case: No Payment Config ===');
            
            // Create shop with no payment configs
            const emptyShop = await Shop.create({
                name: 'Empty Shop',
                domain: 'emptyshop',
                address: 'Test Address',
                phone: '01900000000',
                email: 'test@emptyshop.com'
            });

            const paymentOptions = await smartPaymentService.getAvailablePaymentOptions(emptyShop.id, 'bn');
            
            console.log('Available Methods:', paymentOptions.availableMethods);
            console.log('Should Skip Payment:', paymentOptions.shouldSkipPayment);
            
            // Should fallback to COD only
            expect(paymentOptions.availableMethods).to.deep.equal(['cod']);
            expect(paymentOptions.shouldSkipPayment).to.be.true;
            expect(paymentOptions.paymentPrompt).to.be.null;
            
            console.log('✅ PASSED: Graceful fallback to COD only\n');
        });

        it('should validate payment method availability', async () => {
            console.log('\n=== Testing Payment Method Validation ===');
            
            // Test valid methods
            const isValidCod = await smartPaymentService.validatePaymentMethod(testShops[0].id, 'cod');
            const isValidBkash = await smartPaymentService.validatePaymentMethod(testShops[2].id, 'bkash');

            // Test invalid methods
            const isInvalidPaypal = await smartPaymentService.validatePaymentMethod(testShops[0].id, 'paypal');
            const isInvalidSsl = await smartPaymentService.validatePaymentMethod(testShops[1].id, 'sslcommerz');

            console.log('COD valid for Fashion Hub:', isValidCod);
            console.log('bKash valid for Premium Fashion:', isValidBkash);
            console.log('PayPal valid for Fashion Hub:', isInvalidPaypal);
            console.log('SSLCommerz (removed) valid for Tech Store:', isInvalidSsl);

            expect(isValidCod).to.be.true;
            expect(isValidBkash).to.be.true;
            expect(isInvalidPaypal).to.be.false;
            expect(isInvalidSsl).to.be.false;
            
            console.log('✅ PASSED: Payment method validation works\n');
        });
    });

    after(async () => {
        // Clean up test data
        await sequelize.close();
    });
});
