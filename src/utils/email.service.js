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

    const from = process.env.EMAIL_FROM || 'Easy Moderator <no-reply@easymod.co>';
    await client.emails.send({ from, to, subject, text, html });
    return { sent: true };
};

module.exports = { sendEmail };
