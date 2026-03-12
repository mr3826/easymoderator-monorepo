const { SupportTicket } = require('../entities');
const { AppError } = require('../../utils/AppError');

const createTicket = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const payload = req.body;
        if (!payload.tenant_id || !payload.customer_id) {
            throw new AppError('tenant_id and customer_id are required', 400);
        }
        const ticketNumber = `TKT-${String(Date.now()).slice(-5)}`;

        const ticket = await SupportTicket.create({
            ticket_number: ticketNumber,
            tenant_id: payload.tenant_id,
            shop_id: payload.shop_id || shopId,
            customer_id: payload.customer_id,
            conversation_id: payload.conversation_id || null,
            priority: payload.priority || 'low',
            category: payload.category || null,
            description: payload.description || null,
            metadata: payload.metadata || {}
        });

        res.status(201).json({
            ticket_id: ticket.id,
            ticket_number: ticket.ticket_number,
            status: ticket.status,
            assigned_to: ticket.assigned_to,
            created_at: ticket.created_at,
            estimated_response_time: '5 minutes'
        });
    } catch (error) {
        next(error);
    }
};

const getUserTickets = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const whereClause = { shop_id: shopId };
        if (req.query.status) {
            whereClause.status = req.query.status;
        }

        const tickets = await SupportTicket.findAll({
            where: whereClause,
            order: [['created_at', 'DESC']]
        });

        res.status(200).json({
            tickets: tickets.map(ticket => ({
                ticket_id: ticket.id,
                ticket_number: ticket.ticket_number,
                status: ticket.status,
                priority: ticket.priority,
                category: ticket.category,
                created_at: ticket.created_at
            })),
            total: tickets.length
        });
    } catch (error) {
        next(error);
    }
};

const getTicket = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const ticket = await SupportTicket.findOne({
            where: {
                id: req.params.ticketId,
                shop_id: shopId
            }
        });

        if (!ticket) {
            throw new AppError('Ticket not found', 404);
        }

        res.status(200).json({
            ticket_id: ticket.id,
            ticket_number: ticket.ticket_number,
            status: ticket.status,
            customer_id: ticket.customer_id,
            assigned_to: ticket.assigned_to,
            messages: [],
            created_at: ticket.created_at
        });
    } catch (error) {
        next(error);
    }
};

const updateTicket = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const ticket = await SupportTicket.findOne({
            where: {
                id: req.params.ticketId,
                shop_id: shopId
            }
        });

        if (!ticket) {
            throw new AppError('Ticket not found', 404);
        }

        const updates = {
            priority: req.body.priority !== undefined ? req.body.priority : ticket.priority,
            category: req.body.category !== undefined ? req.body.category : ticket.category,
            description: req.body.description !== undefined ? req.body.description : ticket.description,
            status: req.body.status !== undefined ? req.body.status : ticket.status,
            assigned_to: req.body.assigned_to !== undefined ? req.body.assigned_to : ticket.assigned_to,
            metadata: req.body.metadata !== undefined ? req.body.metadata : ticket.metadata
        };

        await ticket.update(updates);

        res.status(200).json({
            ticket_id: ticket.id,
            status: ticket.status,
            updated_at: ticket.updated_at
        });
    } catch (error) {
        next(error);
    }
};

const replyToTicket = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const ticket = await SupportTicket.findOne({
            where: {
                id: req.params.ticketId,
                shop_id: shopId
            }
        });

        if (!ticket) {
            throw new AppError('Ticket not found', 404);
        }

        const existingMessages = Array.isArray(ticket.metadata?.messages)
            ? ticket.metadata.messages
            : [];

        const message = {
            id: `msg_${Date.now()}`,
            message: req.body.message,
            is_internal: Boolean(req.body.is_internal),
            created_at: new Date().toISOString()
        };

        await ticket.update({
            metadata: {
                ...ticket.metadata,
                messages: [...existingMessages, message]
            }
        });

        res.status(201).json({
            message_id: message.id,
            created_at: message.created_at
        });
    } catch (error) {
        next(error);
    }
};

const closeTicket = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const ticket = await SupportTicket.findOne({
            where: {
                id: req.params.ticketId,
                shop_id: shopId
            }
        });

        if (!ticket) {
            throw new AppError('Ticket not found', 404);
        }

        await ticket.update({ status: 'closed' });

        res.status(200).json({
            ticket_id: ticket.id,
            status: ticket.status
        });
    } catch (error) {
        next(error);
    }
};

const notifyAgents = async (req, res, next) => {
    try {
        const channels = req.body?.channels || [];
        res.status(200).json({
            notified: true,
            channels_sent: channels
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    createTicket,
    getTicket,
    notifyAgents,
    getUserTickets,
    updateTicket,
    replyToTicket,
    closeTicket
};
