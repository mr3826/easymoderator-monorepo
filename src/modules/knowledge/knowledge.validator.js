const Joi = require('joi');

class KnowledgeValidator {
    getKnowledge = {};

    updateBusinessInfo = {
        body: Joi.object({
            shopName: Joi.string().trim().allow('').optional(),
            address: Joi.string().trim().allow('').optional(),
            phone: Joi.string().trim().allow('').optional(),
            openingHours: Joi.string().trim().allow('').optional(),
            deliveryAreas: Joi.array().items(Joi.string().trim()).optional(),
            paymentMethods: Joi.array().items(Joi.string().trim()).optional()
        })
    };

    updateBrandingRules = {
        body: Joi.object({
            tone:               Joi.string().valid('formal', 'friendly', 'casual').optional(),
            languagePreference: Joi.string().trim().max(20).optional(),
            emojiUsage:         Joi.string().valid('none', 'light', 'moderate', 'heavy').optional(),
            forbiddenPhrases:   Joi.array().items(Joi.string().trim().max(200)).max(100).optional(),
            escalationKeywords: Joi.array().items(Joi.string().trim().max(100)).max(50).optional(),
            greetingStyle:      Joi.string().trim().max(500).optional(),
            closingStyle:       Joi.string().trim().max(500).optional(),
        }).options({ allowUnknown: false })
    };

    createFaq = {
        body: Joi.object({
            question:    Joi.string().trim().required(),
            answer:      Joi.string().trim().required(),
            category:    Joi.string().trim().optional(),
            template_bn: Joi.string().trim().allow('', null).optional(),
            template_en: Joi.string().trim().allow('', null).optional(),
            priority:    Joi.number().integer().min(0).max(1000).optional(),
            confidence:  Joi.number().min(0).max(1).optional(),
            source:      Joi.string().trim().optional(),
            active:      Joi.boolean().optional(),
            usageCount:  Joi.number().integer().min(0).optional()
        })
    };

    updateFaq = {
        params: Joi.object({
            id: Joi.string().required()
        }),
        body: Joi.object({
            question: Joi.string().trim().optional(),
            answer: Joi.string().trim().optional(),
            category: Joi.string().trim().optional(),
            confidence: Joi.number().min(0).max(1).optional(),
            source: Joi.string().trim().optional(),
            active: Joi.boolean().optional(),
            usageCount: Joi.number().integer().min(0).optional()
        })
    };

    deleteFaq = {
        params: Joi.object({
            id: Joi.string().required()
        })
    };

    updateGaps = {
        body: Joi.array().items(Joi.object({
            id: Joi.string().required(),
            question: Joi.string().trim().required(),
            frequency: Joi.number().integer().min(0).required(),
            suggestedAnswer: Joi.string().trim().optional(),
            confidence: Joi.number().min(0).max(1).optional(),
            firstAsked: Joi.string().optional(),
            lastAsked: Joi.string().optional()
        }))
    };

    createDocument = {
        body: Joi.object({
            name: Joi.string().trim().required(),
            contentType: Joi.string().trim().optional(),
            size: Joi.number().integer().min(0).optional(),
            url: Joi.string().uri().optional(),
            text: Joi.string().allow('').optional(),
            tags: Joi.array().items(Joi.string().trim()).optional(),
            source: Joi.string().trim().optional(),
            status: Joi.string().trim().optional()
        })
    };

    deleteDocument = {
        params: Joi.object({
            id: Joi.string().required()
        })
    };
}

module.exports = new KnowledgeValidator();
