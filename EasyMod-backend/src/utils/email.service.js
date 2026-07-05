const { Resend } = require('resend');

const getClient = () => {
    if (!process.env.RESEND_API_KEY) return null;
    return new Resend(process.env.RESEND_API_KEY);
};

const sendEmail = async ({ to, subject, text, html }) => {
    const client = getClient();
    if (!client) {
        console.warn('[email] RESEND_API_KEY not configured — skipping email send.', { to, subject });
        return { sent: false };
    }

    const from = process.env.EMAIL_FROM || 'EasyModerator <no-reply@easymod.tech>';

    // The Resend SDK does NOT throw on API errors (unverified sender domain,
    // invalid/restricted key, bad `from`, rate limit). It resolves to
    // `{ data, error }`. We MUST inspect `error` — otherwise a send that never
    // left is silently reported as success (the forgot-password "no email
    // arrives but the UI says it did" bug).
    try {
        const { data, error } = await client.emails.send({ from, to, subject, text, html });
        if (error) {
            console.error('[email] send rejected by Resend — email NOT delivered.', {
                to,
                subject,
                from,
                error: { name: error.name, message: error.message, statusCode: error.statusCode },
            });
            return { sent: false, error };
        }
        return { sent: true, id: data?.id };
    } catch (err) {
        // Network / unexpected throw — also a non-delivery, never swallow it.
        console.error('[email] send threw — email NOT delivered.', { to, subject, from, error: err.message });
        return { sent: false, error: err };
    }
};

module.exports = { sendEmail };
