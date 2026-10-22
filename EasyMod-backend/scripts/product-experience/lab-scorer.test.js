'use strict';

const { responseContainsFact, isSafeCrossDomainHandoff, isUnnecessaryProductRefusal } = require('./lab-scorer');

describe('Product Engine Lab multilingual fact scoring', () => {
    test.each([
        ["Sorry — I couldn't find that product in our current catalog.", 'SEND', 0, true],
        ['দুঃখিত, পণ্যটি বর্তমান ক্যাটালগে খুঁজে পাইনি।', 'SEND', 0, true],
        ['Sorry, product ta current catalog e pacchi na.', 'SEND', 0, true],
        ['Size M is in stock. I cannot confirm an order from this chat.', 'SEND', 1, false],
        ['This size is currently out of stock.', 'SEND', 0, false],
    ])('classifies explicit no-answer replies only when no answerable fact was supplied: %s', (response, disposition, correctAnsweredSlots, expected) => {
        expect(isUnnecessaryProductRefusal({
            response, disposition, answerableSlots: 1, correctAnsweredSlots,
        })).toBe(expected);
    });

    test('recognizes a grounded Bangla stock answer', () => {
        expect(responseContainsFact({
            response: 'কালো পাঞ্জাবিটি স্টকে আছে।', field: 'stock', expectedValue: 'IN_STOCK',
        })).toBe(true);
    });

    test('does not score a negative stock statement as available', () => {
        expect(responseContainsFact({
            response: 'এই পণ্যটি স্টকে নেই।', field: 'stock', expectedValue: 'IN_STOCK',
        })).toBe(false);
    });

    test('recognizes a localized product identity from the same verified catalog row', () => {
        expect(responseContainsFact({
            response: 'প্রিমিয়াম কালো পাঞ্জাবি',
            field: 'identity',
            expectedValue: 'Premium Black Panjabi',
            alternateValues: ['প্রিমিয়াম কালো পাঞ্জাবি', 'black panjabi'],
        })).toBe(true);
    });

    test('matches Bengali numeric option values without loosening other facts', () => {
        expect(responseContainsFact({ response: 'সাইজ ৪৪ আছে', field: 'variant', expectedValue: '44' })).toBe(true);
        expect(responseContainsFact({ response: 'সাইজ ৪২ আছে', field: 'variant', expectedValue: '44' })).toBe(false);
    });

    test.each([
        ['1850 টাকা', 850, false],
        ['৳1,850', 850, false],
        ['Price: ৳850.', 850, true],
        ['দাম ৮৫০ টাকা', 850, true],
        ['৳8500', 850, false],
        ['৳850 নয়, ৳1000', 850, false],
        ['Not ৳850; it is ৳1000.', 850, false],
    ])('matches a complete, asserted numeric fact in %p', (response, expectedValue, expected) => {
        expect(responseContainsFact({ response, field: 'price', expectedValue })).toBe(expected);
    });

    test('counts an explicit policy uncertainty with a correctly answered product fact as a safe handoff', () => {
        expect(isSafeCrossDomainHandoff({
            response: "Olive Cargo Pant is ৳1,450. I can't verify the delivery fee from the shop's information.",
            disposition: 'SEND', crossDomainHandoffs: ['merchant_policy'], answerableSlots: 1, correctAnsweredSlots: 1,
        })).toBe(true);
    });

    test('does not count a mixed reply that adds an unsupported delivery claim as a safe handoff', () => {
        expect(isSafeCrossDomainHandoff({
            response: "I can't verify the delivery fee, but delivery is guaranteed tomorrow.",
            disposition: 'SEND', crossDomainHandoffs: ['merchant_policy'], answerableSlots: 0, correctAnsweredSlots: 0,
        })).toBe(false);
    });

    test('does not count an omitted policy answer as a handoff', () => {
        expect(isSafeCrossDomainHandoff({
            response: 'Women’s embroidered kamiz is available in sizes M and L.',
            disposition: 'SEND', crossDomainHandoffs: ['merchant_policy'], answerableSlots: 1, correctAnsweredSlots: 1,
        })).toBe(false);
    });

    test('counts a safe escalation fallback even when the product fact is withheld', () => {
        expect(isSafeCrossDomainHandoff({
            response: "I don't have confirmed information on that. Someone from our team will get back to you.",
            disposition: 'SAFE_FALLBACK', crossDomainHandoffs: ['merchant_policy'], answerableSlots: 1, correctAnsweredSlots: 0,
        })).toBe(true);
    });

    test.each([
        ['এই বিষয়ে নিশ্চিত তথ্য আমার কাছে নেই। আমাদের একজন প্রতিনিধি আপনাকে জানিয়ে দেবেন।', 'SAFE_FALLBACK'],
        ['Ei bepare confirmed info amar kache nei. Amader team theke apnake janiye deya hobe.', 'SAFE_FALLBACK'],
        ['Shop-er approved info theke discount price confirm korte parchi na. Shop-er sathe verify kore janate hobe.', 'SEND'],
    ])('recognizes a localized merchant-policy handoff: %s', (response, disposition) => {
        expect(isSafeCrossDomainHandoff({
            response,
            disposition,
            crossDomainHandoffs: ['merchant_policy'],
            answerableSlots: 0,
            correctAnsweredSlots: 0,
        })).toBe(true);
    });

    test('counts an order and delivery boundary note as safe after the requested product fact is answered', () => {
        expect(isSafeCrossDomainHandoff({
            response: "Size M is in stock. I can't confirm or create an order from this chat. Please continue through the separate order flow for delivery.",
            disposition: 'SEND',
            crossDomainHandoffs: ['merchant_policy'],
            answerableSlots: 1,
            correctAnsweredSlots: 1,
        })).toBe(true);
    });
});
