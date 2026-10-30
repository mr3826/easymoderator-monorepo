'use strict';

const Joi = require('joi');

// Route-level guard rails for MW-V1 customer notes; the service owns the
// authoritative trimming/sizing and author rules.
class CustomerNotesValidator {
    byId = Joi.object({ id: Joi.string().uuid().required() });

    byNoteId = Joi.object({ id: Joi.string().uuid().required(), noteId: Joi.string().uuid().required() });

    body = Joi.object({
        body: Joi.string().min(1).max(2000).required()
    });

    listQuery = Joi.object({
        limit: Joi.number().integer().min(1).max(100).default(20),
        before: Joi.string().isoDate().optional()
    });
}

module.exports = new CustomerNotesValidator();
