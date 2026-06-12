/**
 * detectLanguage — Banglish (Romanised Bengali) must be treated as Bengali so the
 * order flow replies in Bengali to a Banglish customer instead of English.
 * (Founder feedback 2026-06-13: the bot asked name/phone/address in English to
 * customers who were typing "ami order korbo".)
 *
 * The deps that pull in the DB layer are mocked so the pure static method can be
 * unit-tested without a database connection.
 */
jest.mock('../../customer/customer.entity', () => ({}));
jest.mock('../conversation.entity', () => ({ Conversation: {}, Message: {} }));
jest.mock('../../order/order-session-standalone.service', () => ({}));

const ConversationStateService = require('../conversation-state-standalone.service');

describe('ConversationStateService.detectLanguage', () => {
    test('pure Bengali script → bn', () => {
        expect(ConversationStateService.detectLanguage('আপনার নাম কী?')).toBe('bn');
        expect(ConversationStateService.detectLanguage('আমি অর্ডার করব')).toBe('bn');
    });

    test('genuine English → en', () => {
        expect(ConversationStateService.detectLanguage('I want to buy this dress')).toBe('en');
        expect(ConversationStateService.detectLanguage('please send me the price')).toBe('en');
        expect(ConversationStateService.detectLanguage('do you have this in red?')).toBe('en');
    });

    test('Banglish (Romanised Bengali) → bn, not en', () => {
        const banglish = [
            'ami order korbo',
            'naam Rahim',
            'koyta lagbe',
            'apnar product ta nibo',
            'oder korbo bhai',
            'amar lagbe akta',
            'dhaka te pathaben',
        ];
        for (const msg of banglish) {
            expect(ConversationStateService.detectLanguage(msg)).toBe('bn');
        }
    });

    test('Bengali script + Latin together → mixed', () => {
        expect(ConversationStateService.detectLanguage('আমি order korbo')).toBe('mixed');
    });

    test('digits / symbols only → unknown', () => {
        expect(ConversationStateService.detectLanguage('12345')).toBe('unknown');
        expect(ConversationStateService.detectLanguage('01712345678')).toBe('unknown');
    });
});
