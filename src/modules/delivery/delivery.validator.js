const { body, param, validationResult } = require('express-validator');

/**
 * Validation rules for delivery settings
 */
const deliveryValidators = {
    /**
     * Validate connect provider request
     */
    connectProvider: [
        body('provider')
            .isIn(['pathao', 'steadfast'])
            .withMessage('Provider must be either pathao or steadfast'),
        
        body('credentials')
            .isObject()
            .withMessage('Credentials must be an object'),

        // Pathao-specific validation
        body('credentials.client_id')
            .if(body('provider').equals('pathao'))
            .notEmpty()
            .withMessage('Client ID is required for Pathao'),

        body('credentials.client_secret')
            .if(body('provider').equals('pathao'))
            .notEmpty()
            .withMessage('Client Secret is required for Pathao'),

        body('credentials.username')
            .if(body('provider').equals('pathao'))
            .isEmail()
            .withMessage('Valid email is required for Pathao username'),

        body('credentials.password')
            .if(body('provider').equals('pathao'))
            .notEmpty()
            .withMessage('Password is required for Pathao'),

        // Steadfast-specific validation
        body('credentials.api_key')
            .if(body('provider').equals('steadfast'))
            .notEmpty()
            .withMessage('API Key is required for Steadfast'),

        body('credentials.secret_key')
            .if(body('provider').equals('steadfast'))
            .notEmpty()
            .withMessage('Secret Key is required for Steadfast'),

        body('is_sandbox')
            .optional()
            .isBoolean()
            .withMessage('is_sandbox must be a boolean'),

        body('metadata')
            .optional()
            .isObject()
            .withMessage('Metadata must be an object')
    ],

    /**
     * Validate disconnect provider request
     */
    disconnectProvider: [
        body('provider')
            .isIn(['pathao', 'steadfast'])
            .withMessage('Provider must be either pathao or steadfast')
    ],

    /**
     * Validate toggle provider request
     */
    toggleProvider: [
        body('provider')
            .isIn(['pathao', 'steadfast'])
            .withMessage('Provider must be either pathao or steadfast'),
        
        body('is_active')
            .isBoolean()
            .withMessage('is_active must be a boolean')
    ]
};

/**
 * Check validation results
 */
const checkValidation = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            errors: errors.array()
        });
    }
    next();
};

module.exports = {
    deliveryValidators,
    checkValidation
};
