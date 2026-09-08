'use strict';

const fs = require('fs');
const path = require('path');

const mockSequelize = {
    define: jest.fn((_name, attributes) => ({ rawAttributes: attributes })),
};
jest.mock('../../../utils/database/database-setup', () => ({ sequelize: mockSequelize }));

const { Message } = require('../conversation.entity');

const matchingDelimiter = (source, start, opening, closing) => {
    let depth = 0;
    let quote = null;
    let escaped = false;

    for (let index = start; index < source.length; index += 1) {
        const character = source[index];
        if (quote) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === quote) quote = null;
            continue;
        }
        if (character === "'" || character === '"' || character === '`') {
            quote = character;
            continue;
        }
        if (character === opening) depth += 1;
        if (character === closing) {
            depth -= 1;
            if (depth === 0) return index;
        }
    }
    return -1;
};

const messageAttributeArrays = (source) => {
    const arrays = [];
    const messageCall = /Message\.(?:findOne|findAll|findAndCountAll)\s*\(\s*\{/g;
    for (const match of source.matchAll(messageCall)) {
        const objectStart = match.index + match[0].lastIndexOf('{');
        const objectEnd = matchingDelimiter(source, objectStart, '{', '}');
        if (objectEnd < 0) continue;
        const callBody = source.slice(objectStart, objectEnd + 1);
        const attributesOffset = callBody.indexOf('attributes:');
        if (attributesOffset < 0) continue;
        const arrayStart = callBody.indexOf('[', attributesOffset);
        const arrayEnd = matchingDelimiter(callBody, arrayStart, '[', ']');
        if (arrayStart < 0 || arrayEnd < 0) continue;
        arrays.push([...callBody.slice(arrayStart + 1, arrayEnd).matchAll(/(['"])([^'"\\]+)\1/g)]
            .map(([, , field]) => field));
    }
    return arrays;
};

test('every explicit Message projection uses a declared Message attribute', () => {
    const servicePath = path.join(__dirname, '..', 'conversation.service.js');
    const source = fs.readFileSync(servicePath, 'utf8');
    const modelAttributes = new Set(Object.keys(Message.rawAttributes));
    const projections = messageAttributeArrays(source);

    expect(projections.length).toBeGreaterThan(0);
    for (const projection of projections) {
        expect(projection.filter((field) => !modelAttributes.has(field))).toEqual([]);
    }
});
