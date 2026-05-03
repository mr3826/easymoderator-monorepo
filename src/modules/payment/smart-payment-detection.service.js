/**
 * Smart Payment Detection Service
 * Intelligently detects shop owner's payment integrations and generates appropriate payment options
 * Used by chatbot to show only available payment methods to customers
 */

const { PaymentConfig, Shop } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');
const { getBdSettings, hasSelfMfs } = require('../shop/shop-bd-settings');

class SmartPaymentDetectionService {
    constructor() {
        this.logger = createLogger();
    }

    /**
     * Get available payment options for a shop
     * Returns intelligent payment options based on shop's integrations
     */
    async getAvailablePaymentOptions(shopId, language = 'mixed') {
        try {
            // Get all enabled payment configs for the shop
            const paymentConfigs = await PaymentConfig.findAll({
                where: {
                    shop_id: shopId,
                    is_enabled: true
                },
                attributes: ['gateway', 'config', 'credentials']
            });

            // Get BD settings for self-MFS
            const bdSettings = await getBdSettings(shopId);
            const hasSelfMfsConfig = hasSelfMfs(bdSettings);

            // Analyze available payment methods
            const paymentOptions = this.analyzePaymentMethods(paymentConfigs, hasSelfMfsConfig, bdSettings);

            // Generate appropriate payment prompt
            const paymentPrompt = this.generatePaymentPrompt(paymentOptions, language);

            // Determine if we should skip payment step entirely
            const shouldSkipPayment = this.shouldSkipPaymentStep(paymentOptions);

            this.logger.info('Payment options analyzed', {
                shopId,
                availableMethods: paymentOptions.availableMethods,
                shouldSkipPayment,
                totalOptions: paymentOptions.availableMethods.length
            });

            return {
                paymentOptions,
                paymentPrompt,
                shouldSkipPayment,
                availableMethods: paymentOptions.availableMethods
            };

        } catch (error) {
            this.logger.error('Failed to get payment options', {
                shopId,
                error: error.message
            });
            
            // Fallback to COD only
            return this.getCodOnlyFallback(language);
        }
    }

    /**
     * Analyze payment configurations and determine available methods
     */
    analyzePaymentMethods(paymentConfigs, hasSelfMfsConfig, bdSettings) {
        const availableMethods = [];
        const methodDetails = {};
        let hasCod = false;
        let hasOnlinePayment = false;
        let hasMerchantMfs = false;
        let hasSelfMfs = false;

        // Check each payment config
        paymentConfigs.forEach(config => {
            const gateway = config.gateway;
            
            switch (gateway) {
                case 'cod':
                    hasCod = true;
                    methodDetails.cod = {
                        type: 'cod',
                        name: 'Cash on Delivery',
                        nameBn: 'ক্যাশ অন ডেলিভারি',
                        description: 'Pay when you receive the product',
                        descriptionBn: 'পণ্য পেয়ে পেমেন্ট করুন'
                    };
                    break;

                case 'self-mfs':
                    hasSelfMfs = hasSelfMfsConfig;
                    if (hasSelfMfsConfig) {
                        const mfsType = bdSettings.mfs_type;
                        methodDetails[mfsType] = {
                            type: 'self_mfs',
                            gateway: mfsType,
                            name: mfsType === 'nagad' ? 'Nagad' : 'bKash',
                            nameBn: mfsType === 'nagad' ? 'নগদ' : 'বিকাশ',
                            description: `Pay to personal ${mfsType === 'nagad' ? 'Nagad' : 'bKash'} number`,
                            descriptionBn: `ব্যক্তিগত ${mfsType === 'nagad' ? 'নগদ' : 'বিকাশ'} নম্বরে পেমেন্ট করুন`,
                            phoneNumber: bdSettings.mfs_number
                        };
                    }
                    break;
            }
        });

        // Check for merchant MFS (bKash/Nagad merchant APIs)
        if (paymentConfigs.some(config => config.gateway === 'bkash-merchant')) {
            hasMerchantMfs = true;
            hasOnlinePayment = true;
            methodDetails.bkash = {
                type: 'merchant_mfs',
                gateway: 'bkash',
                name: 'bKash',
                nameBn: 'বিকাশ',
                description: 'Pay online via bKash',
                descriptionBn: 'বিকাশ দিয়ে অনলাইনে পেমেন্ট করুন'
            };
        }

        if (paymentConfigs.some(config => config.gateway === 'nagad-merchant')) {
            hasMerchantMfs = true;
            hasOnlinePayment = true;
            methodDetails.nagad = {
                type: 'merchant_mfs',
                gateway: 'nagad',
                name: 'Nagad',
                nameBn: 'নগদ',
                description: 'Pay online via Nagad',
                descriptionBn: 'নগদ দিয়ে অনলাইনে পেমেন্ট করুন'
            };
        }

        // Build available methods array in order of preference
        if (hasCod) availableMethods.push('cod');
        if (hasOnlinePayment) {
            if (methodDetails.bkash) availableMethods.push('bkash');
            if (methodDetails.nagad) availableMethods.push('nagad');
        }
        if (hasSelfMfs) {
            const mfsType = bdSettings.mfs_type;
            if (methodDetails[mfsType]) availableMethods.push(mfsType);
        }

        return {
            availableMethods,
            methodDetails,
            hasCod,
            hasOnlinePayment,
            hasMerchantMfs,
            hasSelfMfs,
            totalMethods: availableMethods.length
        };
    }

    /**
     * Generate appropriate payment prompt based on available methods
     */
    generatePaymentPrompt(paymentOptions, language) {
        const { availableMethods, methodDetails } = paymentOptions;

        // If only COD is available, skip payment step
        if (availableMethods.length === 1 && availableMethods[0] === 'cod') {
            return null; // Skip payment step
        }

        // Build payment options text
        let optionsText = '';
        let bnOptions = '';
        let enOptions = '';

        availableMethods.forEach((method, index) => {
            const details = methodDetails[method];
            const optionNumber = index + 1;
            
            if (language === 'bn') {
                bnOptions += `${optionNumber}. ${details.nameBn} - ${details.descriptionBn}\n`;
            } else if (language === 'en') {
                enOptions += `${optionNumber}. ${details.name} - ${details.description}\n`;
            } else {
                // Mixed language
                bnOptions += `${optionNumber}. ${details.nameBn} - ${details.descriptionBn}\n`;
                enOptions += `${optionNumber}. ${details.name} - ${details.description}\n`;
            }
        });

        // Build complete prompt
        if (language === 'bn') {
            optionsText = `পেমেন্ট পদ্ধতি নির্বাচন করুন:\n\n${bnOptions}\nঅনুগ্রহ করে একটি বিকল্প নির্বাচন করুন (১-${availableMethods.length})`;
        } else if (language === 'en') {
            optionsText = `Please select a payment method:\n\n${enOptions}\nPlease select an option (1-${availableMethods.length})`;
        } else {
            // Mixed language
            optionsText = `পেমেন্ট পদ্ধতি নির্বাচন করুন / Please select a payment method:\n\n${bnOptions}\n${enOptions}\nঅনুগ্রহ করে একটি বিকল্প নির্বাচন করুন (১-${availableMethods.length}) / Please select an option (1-${availableMethods.length})`;
        }

        return optionsText;
    }

    /**
     * Determine if payment step should be skipped
     */
    shouldSkipPaymentStep(paymentOptions) {
        // Skip if only COD is available
        if (paymentOptions.availableMethods.length === 1 && paymentOptions.availableMethods[0] === 'cod') {
            return true;
        }

        // Skip if no payment methods are configured (fallback to COD)
        if (paymentOptions.availableMethods.length === 0) {
            return true;
        }

        return false;
    }

    /**
     * Get payment method details for processing
     */
    getPaymentMethodDetails(shopId, selectedMethod) {
        // This will be used by order session to process the selected payment method
        return {
            method: selectedMethod,
            processingType: this.getProcessingType(selectedMethod),
            requiresVerification: this.requiresVerification(selectedMethod),
            nextStep: this.getNextStep(selectedMethod)
        };
    }

    /**
     * Get processing type for payment method
     */
    getProcessingType(method) {
        const processingTypes = {
            'cod': 'automatic',
            'bkash': 'merchant_api',
            'nagad': 'merchant_api',
            'bkash-self': 'owner_verification',
            'nagad-self': 'owner_verification',
            'rocket-self': 'owner_verification'
        };

        return processingTypes[method] || 'automatic';
    }

    /**
     * Check if payment method requires verification
     */
    requiresVerification(method) {
        const verificationRequired = {
            'cod': false,
            'bkash': true,
            'nagad': true,
            'bkash-self': true,
            'nagad-self': true,
            'rocket-self': true
        };

        return verificationRequired[method] || false;
    }

    /**
     * Get next step for payment method
     */
    getNextStep(method) {
        const nextSteps = {
            'cod': 'COLLECTING_NOTES',
            'bkash': 'AWAITING_ONLINE_PAYMENT',
            'nagad': 'AWAITING_ONLINE_PAYMENT',
            'bkash-self': 'AWAITING_SELF_MFS_PAYMENT',
            'nagad-self': 'AWAITING_SELF_MFS_PAYMENT',
            'rocket-self': 'AWAITING_SELF_MFS_PAYMENT'
        };

        return nextSteps[method] || 'COLLECTING_NOTES';
    }

    /**
     * Fallback for when payment detection fails
     */
    getCodOnlyFallback(language) {
        return {
            paymentOptions: {
                availableMethods: ['cod'],
                methodDetails: {
                    cod: {
                        type: 'cod',
                        name: 'Cash on Delivery',
                        nameBn: 'ক্যাশ অন ডেলিভারি',
                        description: 'Pay when you receive the product',
                        descriptionBn: 'পণ্য পেয়ে পেমেন্ট করুন'
                    }
                },
                hasCod: true,
                hasOnlinePayment: false,
                hasMerchantMfs: false,
                hasSelfMfs: false,
                totalMethods: 1
            },
            paymentPrompt: null, // Skip payment step
            shouldSkipPayment: true,
            availableMethods: ['cod']
        };
    }

    /**
     * Validate if payment method is available for shop
     */
    async validatePaymentMethod(shopId, paymentMethod) {
        try {
            const paymentOptions = await this.getAvailablePaymentOptions(shopId);
            return paymentOptions.availableMethods.includes(paymentMethod);
        } catch (error) {
            this.logger.error('Failed to validate payment method', {
                shopId,
                paymentMethod,
                error: error.message
            });
            return false;
        }
    }

    /**
     * Get payment method from user input
     */
    extractPaymentMethod(userInput, availableMethods, methodDetails) {
        const input = userInput.toLowerCase().trim();
        
        // Direct method name matching
        for (const method of availableMethods) {
            const details = methodDetails[method];
            if (details.nameBn.toLowerCase().includes(input) || 
                details.name.toLowerCase().includes(input)) {
                return method;
            }
        }

        // Number matching (1, 2, 3, etc.)
        const numberMatch = input.match(/\d+/);
        if (numberMatch) {
            const index = parseInt(numberMatch[0]) - 1;
            if (index >= 0 && index < availableMethods.length) {
                return availableMethods[index];
            }
        }

        // Keyword matching
        const keywordMap = {
            'cod': ['cod', 'cash', 'ক্যাশ', 'delivery', 'ডেলিভারি'],
            'bkash': ['bkash', 'বিকাশ', 'bikash'],
            'nagad': ['nagad', 'নগদ', 'nogod']
        };

        for (const [method, keywords] of Object.entries(keywordMap)) {
            if (availableMethods.includes(method) && keywords.some(keyword => input.includes(keyword))) {
                return method;
            }
        }

        return null;
    }
}

module.exports = new SmartPaymentDetectionService();
