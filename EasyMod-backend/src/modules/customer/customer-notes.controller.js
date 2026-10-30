'use strict';

// MW-V1 CRM Lite — HTTP surface for staff-private customer notes (doc 05).
// Shop identity comes ONLY from the JWT (authenticate + req.user.shopId);
// the service re-verifies active membership on every call.

const customerNotesService = require('./customer-notes.service');

const actorOf = (req) => ({
    userId: req.user?.userId || req.user?.id || null,
    role: req.user?.role || req.userRole || null,
    name: req.user?.full_name || null,
    email: req.user?.email || null,
});

const reply = (res, promise, status = 200) =>
    promise
        .then((data) => res.status(status).json({ success: true, data }))
        .catch((error) => {
            const statusCode = error.statusCode || 500;
            res.status(statusCode).json({
                success: false,
                error: { code: error.code || 'CUSTOMER_NOTE_FAILED', message: error.message },
            });
        });

exports.listNotes = (req, res) => reply(res, customerNotesService.listNotes(
    {
        shopId: req.user.shopId,
        customerId: req.params.id,
        limit: req.query.limit,
        before: req.query.before,
    },
    actorOf(req),
));

exports.createNote = (req, res) => reply(res, customerNotesService.createNote(
    { shopId: req.user.shopId, customerId: req.params.id, body: req.body.body },
    actorOf(req),
), 201);

exports.updateNote = (req, res) => reply(res, customerNotesService.updateNote(
    { shopId: req.user.shopId, noteId: req.params.noteId, body: req.body.body },
    actorOf(req),
));

exports.deleteNote = (req, res) => reply(res, customerNotesService.deleteNote(
    { shopId: req.user.shopId, noteId: req.params.noteId },
    actorOf(req),
));
