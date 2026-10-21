'use strict';

const { responseContainsFact } = require('./lab-scorer');

describe('Product Engine Lab multilingual fact scoring', () => {
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
});
