const nodemailer = require('nodemailer');

const buildTransport = () => {
    if (!process.env.SMTP_HOST) {
        return null;
    }

    const port = Number.parseInt(process.env.SMTP_PORT || '587', 10);
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;

    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure,
        auth: process.env.SMTP_USER
            ? {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
            : undefined
    });
};

const sendEmail = async ({ to, subject, text, html }) => {
    const transporter = buildTransport();
    if (!transporter) {
        console.warn('SMTP not configured. Skipping email send.', { to, subject });
        return { sent: false };
    }

    const from = process.env.EMAIL_FROM || 'no-reply@easymod.local';

    await transporter.sendMail({
        from,
        to,
        subject,
        text,
        html
    });

    return { sent: true };
};

module.exports = {
    sendEmail
};
