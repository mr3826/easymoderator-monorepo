const { body, param } = require('express-validator');

const createTicketValidator = [
    body('subject')
        .notEmpty()
        .withMessage('Subject is required')
        .isLength({ min: 5, max: 200 })
        .withMessage('Subject must be between 5 and 200 characters'),
    body('description')
        .notEmpty()
        .withMessage('Description is required')
        .isLength({ min: 10, max: 2000 })
        .withMessage('Description must be between 10 and 2000 characters'),
    body('priority')
        .optional()
        .isIn(['low', 'medium', 'high', 'urgent'])
        .withMessage('Priority must be one of: low, medium, high, urgent'),
    body('category')
        .optional()
        .isIn(['technical', 'billing', 'feature_request', 'bug_report', 'general'])
        .withMessage('Category must be one of: technical, billing, feature_request, bug_report, general')
];

const getTicketValidator = [
    param('ticketId')
        .notEmpty()
        .withMessage('Ticket ID is required')
        .isUUID()
        .withMessage('Invalid ticket ID')
];

const updateTicketValidator = [
    param('ticketId')
        .notEmpty()
        .withMessage('Ticket ID is required')
        .isUUID()
        .withMessage('Invalid ticket ID'),
    body('subject')
        .optional()
        .isLength({ min: 5, max: 200 })
        .withMessage('Subject must be between 5 and 200 characters'),
    body('priority')
        .optional()
        .isIn(['low', 'medium', 'high', 'urgent'])
        .withMessage('Priority must be one of: low, medium, high, urgent'),
    body('category')
        .optional()
        .isIn(['technical', 'billing', 'feature_request', 'bug_report', 'general'])
        .withMessage('Category must be one of: technical, billing, feature_request, bug_report, general'),
    body('status')
        .optional()
        .isIn(['open', 'in_progress', 'waiting_for_customer', 'resolved', 'closed'])
        .withMessage('Status must be one of: open, in_progress, waiting_for_customer, resolved, closed')
];

const replyTicketValidator = [
    param('ticketId')
        .notEmpty()
        .withMessage('Ticket ID is required')
        .isUUID()
        .withMessage('Invalid ticket ID'),
    body('message')
        .notEmpty()
        .withMessage('Message is required')
        .isLength({ min: 5, max: 2000 })
        .withMessage('Message must be between 5 and 2000 characters'),
    body('is_internal')
        .optional()
        .isBoolean()
        .withMessage('is_internal must be a boolean')
];

module.exports = {
    createTicketValidator,
    getTicketValidator,
    updateTicketValidator,
    replyTicketValidator
};