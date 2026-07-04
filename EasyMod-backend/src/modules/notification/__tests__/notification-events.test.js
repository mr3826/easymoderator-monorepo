'use strict';

const {
    NOTIFICATION_EVENTS,
    DEFAULT_NOTIFICATION_PREFERENCES,
    normalizePreferences,
    isConfigurableEvent
} = require('../notification-events');

describe('notification-events', () => {
    it('includes the day-one alert event preferences', () => {
        expect(DEFAULT_NOTIFICATION_PREFERENCES).toEqual(expect.objectContaining({
            [NOTIFICATION_EVENTS.NEW_ORDER]: true,
            [NOTIFICATION_EVENTS.AI_HITL]: true,
            [NOTIFICATION_EVENTS.CUSTOMER_WAITING_TOO_LONG]: true,
            [NOTIFICATION_EVENTS.COURIER_BOOKING_FAILED]: true,
            [NOTIFICATION_EVENTS.PAYMENT_SUBSCRIPTION_ISSUE]: true,
            [NOTIFICATION_EVENTS.DAILY_SALES_SUMMARY]: true
        }));
    });

    it('normalizes only known boolean preference keys', () => {
        const result = normalizePreferences({
            [NOTIFICATION_EVENTS.NEW_ORDER]: false,
            unknown_event: false,
            [NOTIFICATION_EVENTS.AI_HITL]: 'yes'
        });

        expect(result[NOTIFICATION_EVENTS.NEW_ORDER]).toBe(false);
        expect(result[NOTIFICATION_EVENTS.AI_HITL]).toBe(true);
        expect(result.unknown_event).toBeUndefined();
        expect(isConfigurableEvent(NOTIFICATION_EVENTS.DAILY_SALES_SUMMARY)).toBe(true);
        expect(isConfigurableEvent(NOTIFICATION_EVENTS.TELEGRAM_TEST)).toBe(false);
    });
});
