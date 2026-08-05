'use strict';

const { NOTIFICATION_EVENTS } = require('./notification-events');
const { getOrigins } = require('../../config/origins');

function baseAppUrl() {
    return getOrigins().app;
}

function money(value) {
    if (value === null || value === undefined || value === '') return null;
    const amount = Number(value);
    if (Number.isNaN(amount)) return String(value);
    return `BDT ${amount.toLocaleString('en-BD')}`;
}

function deepLink(path) {
    return `${baseAppUrl()}${path}`;
}

function compactLines(lines) {
    return lines.filter(Boolean).join('\n');
}

function formatTelegramAlert(eventType, payload = {}) {
    const orderNumber = payload.orderNumber || payload.order_number;
    const customerName = payload.customerName || payload.customer_name;
    const provider = payload.provider || payload.courierProvider;

    switch (eventType) {
        case NOTIFICATION_EVENTS.NEW_ORDER: {
            const url = payload.orderId
                ? deepLink(`/app/orders?orderId=${encodeURIComponent(payload.orderId)}`)
                : deepLink('/app/orders');
            return {
                title: 'New order received',
                body: compactLines([
                    'New order received / নতুন অর্ডার এসেছে',
                    orderNumber ? `Order: #${orderNumber}` : null,
                    customerName ? `Customer: ${customerName}` : null,
                    money(payload.total) ? `Total: ${money(payload.total)}` : null,
                    payload.channel ? `Channel: ${payload.channel}` : null
                ]),
                deepLink: url
            };
        }
        case NOTIFICATION_EVENTS.AI_HITL: {
            const url = payload.conversationId
                ? deepLink(`/app/inbox?conversationId=${encodeURIComponent(payload.conversationId)}`)
                : deepLink('/app/inbox');
            return {
                title: 'AI needs human help',
                body: compactLines([
                    'AI needs human help / AI মানব সহায়তা চায়',
                    payload.reason ? `Reason: ${payload.reason}` : null,
                    payload.customerName ? `Customer: ${payload.customerName}` : null,
                    payload.lastMessage ? `Last message: ${String(payload.lastMessage).slice(0, 180)}` : null
                ]),
                deepLink: url
            };
        }
        case NOTIFICATION_EVENTS.CUSTOMER_WAITING_TOO_LONG: {
            const url = payload.conversationId
                ? deepLink(`/app/inbox?conversationId=${encodeURIComponent(payload.conversationId)}`)
                : deepLink('/app/inbox');
            return {
                title: 'Customer waiting too long',
                body: compactLines([
                    'Customer waiting too long / কাস্টমার বেশি সময় অপেক্ষা করছে',
                    payload.waitMinutes ? `Waiting: ${payload.waitMinutes} minutes` : null,
                    payload.customerName ? `Customer: ${payload.customerName}` : null
                ]),
                deepLink: url
            };
        }
        case NOTIFICATION_EVENTS.COURIER_BOOKING_FAILED: {
            const url = payload.orderId
                ? deepLink(`/app/orders?orderId=${encodeURIComponent(payload.orderId)}`)
                : deepLink('/app/orders');
            return {
                title: 'Courier booking failed',
                body: compactLines([
                    'Courier booking failed / কুরিয়ার বুকিং ব্যর্থ',
                    orderNumber ? `Order: #${orderNumber}` : null,
                    provider ? `Courier: ${provider}` : null,
                    payload.error ? `Reason: ${String(payload.error).slice(0, 220)}` : null
                ]),
                deepLink: url
            };
        }
        case NOTIFICATION_EVENTS.PAYMENT_SUBSCRIPTION_ISSUE: {
            return {
                title: 'Payment or subscription issue',
                body: compactLines([
                    'Payment or subscription issue / পেমেন্ট বা সাবস্ক্রিপশন সমস্যা',
                    payload.issue ? `Issue: ${payload.issue}` : null,
                    payload.invoiceNumber ? `Invoice: ${payload.invoiceNumber}` : null
                ]),
                deepLink: deepLink('/app/subscription')
            };
        }
        case NOTIFICATION_EVENTS.DAILY_SALES_SUMMARY: {
            return {
                title: 'Daily sales summary',
                body: compactLines([
                    'Daily sales summary / দৈনিক বিক্রয় সারাংশ',
                    payload.date ? `Date: ${payload.date}` : null,
                    payload.orderCount !== undefined ? `Orders: ${payload.orderCount}` : null,
                    money(payload.salesTotal) ? `Sales: ${money(payload.salesTotal)}` : null
                ]),
                deepLink: deepLink('/app')
            };
        }
        case NOTIFICATION_EVENTS.TELEGRAM_TEST:
            return {
                title: 'EasyModerator test alert',
                body: compactLines([
                    'EasyModerator test alert',
                    'বাংলা টেস্ট এলার্ট',
                    'Telegram alerts are connected for this shop.'
                ]),
                deepLink: deepLink('/app/manage-shop/notifications')
            };
        default:
            return {
                title: payload.title || 'EasyModerator alert',
                body: payload.body || 'Open EasyModerator to review this alert.',
                deepLink: deepLink('/app')
            };
    }
}

function toPushPayload(eventType, payload = {}) {
    const alert = formatTelegramAlert(eventType, payload);
    return {
        title: alert.title,
        body: alert.body.split('\n')[0],
        icon: '/icon-512.png',
        data: {
            ...(payload.data || {}),
            eventType,
            deepLink: alert.deepLink
        }
    };
}

module.exports = { formatTelegramAlert, toPushPayload };
