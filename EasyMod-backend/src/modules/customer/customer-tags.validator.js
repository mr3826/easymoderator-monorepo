'use strict';

const Joi = require('joi');

class CustomerTagsValidator {
    tagName = Joi.object({ name: Joi.string().min(1).max(30).required() });

    tagParams = Joi.object({ tagId: Joi.string().uuid().required() });

    customerParams = Joi.object({ id: Joi.string().uuid().required() });

    assignment = Joi.object({
        tag_ids: Joi.array().items(Joi.string().uuid()).max(15).required()
    });
}

module.exports = new CustomerTagsValidator();
