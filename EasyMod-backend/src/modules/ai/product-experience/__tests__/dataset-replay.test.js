'use strict';

process.env.NODE_ENV = 'test';

const {
    parseCsv,
    normalizeInputType,
    normalizeLanguage,
    validateDataset,
    classifyExpectedTruth,
} = require('../../../../../scripts/product-experience/replay');

const REQUIRED_HEADER = 'Persona_ID,Customer_Profile,Turn,Input_Type,Language,Customer_Message,Simulated_Attachment,Hallucination_Risk_&_Test_Intent,Expected_AI_Truth';

describe('customer simulator source handling', () => {
    test('CSV parser handles quoted commas, escaped quotes, and embedded newlines', () => {
        const csv = `${REQUIRED_HEADER}\r\nP01,"profile, with comma",1,Text,English,"say ""hello""\nand continue",,risk,expected\r\n`;
        const parsed = parseCsv(csv);

        expect(parsed.records).toHaveLength(1);
        expect(parsed.records[0].customerProfile).toBe('profile, with comma');
        expect(parsed.records[0].customerMessage).toBe('say "hello"\nand continue');
        expect(parsed.records[0].expectedTruth).toBe('expected');
    });

    test('dataset requires twenty personas, ten ordered turns, and explicit image references', () => {
        const records = [];
        for (let persona = 1; persona <= 20; persona += 1) {
            for (let turn = 1; turn <= 10; turn += 1) {
                records.push({
                    personaId: `P${persona}`,
                    turn: String(turn),
                    inputType: turn === 1 ? 'Image' : 'Text',
                    simulatedAttachment: turn === 1 ? '[Image 1: fixture label]' : '',
                });
            }
        }

        expect(validateDataset(records)).toEqual({
            personaCount: 20,
            scenarioCount: 200,
            orderedTurnsPerPersona: 10,
        });
        records[0].simulatedAttachment = '';
        expect(() => validateDataset(records)).toThrow(/image input has no attachment reference/);
    });

    test('header alias, input type, and language normalization accept the source schema', () => {
        expect(parseCsv(`${REQUIRED_HEADER}\nP01,profile,1,Image+Text,Banglish,"hello, shop?",[Image 1: x],risk,expected`).records[0])
            .toEqual(expect.objectContaining({ personaId: 'P01', inputType: 'Image+Text' }));
        expect(normalizeInputType('Text + Image')).toBe('IMAGE_TEXT');
        expect(normalizeLanguage('Bangla')).toBe('bangla');
        expect(normalizeLanguage('Banglish')).toBe('banglish');
        expect(normalizeLanguage('English')).toBe('english');
    });

    test('expected-answer text is tagged for evidence routing, never returned as an oracle', () => {
        const tags = classifyExpectedTruth('Delivery is tomorrow; cotton fabric and size 42 are available.');

        expect(tags).toContain('merchant_policy_fixture_required');
        expect(tags).toContain('live_authoritative_state_required');
        expect(tags).toContain('should_remain_unknown_without_merchant_evidence');
        expect(JSON.stringify(tags)).not.toContain('tomorrow');
    });
});
