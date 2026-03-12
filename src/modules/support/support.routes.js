const express = require('express');
const supportController = require('./support.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { validateRequest } = require('../../middleware/validate-request.middleware');
const supportValidator = require('./support.validator');

const router = express.Router();

// All support routes require authentication
router.use(authenticate);

// POST /support/ticket - Create support ticket
router.post('/ticket', 
    validateRequest(supportValidator.createTicketValidator), 
    supportController.createTicket
);

// GET /support/tickets - Get user's tickets
router.get('/tickets', supportController.getUserTickets);

// GET /support/ticket/:ticketId - Get specific ticket
router.get('/ticket/:ticketId', 
    validateRequest(supportValidator.getTicketValidator), 
    supportController.getTicket
);

// PUT /support/ticket/:ticketId - Update ticket
router.put('/ticket/:ticketId',
    validateRequest(supportValidator.updateTicketValidator),
    supportController.updateTicket
);

// POST /support/ticket/:ticketId/reply - Reply to ticket
router.post('/ticket/:ticketId/reply',
    validateRequest(supportValidator.replyTicketValidator),
    supportController.replyToTicket
);

// PUT /support/ticket/:ticketId/close - Close ticket
router.put('/ticket/:ticketId/close',
    validateRequest(supportValidator.getTicketValidator),
    supportController.closeTicket
);

module.exports = router;
