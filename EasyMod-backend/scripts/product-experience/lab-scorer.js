'use strict';

const normalizeForMatch = value => String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[০-৯]/g, digit => String('০১২৩৪৫৬৭৮৯'.indexOf(digit)))
    .replace(/[_-]/g, ' ')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const numericTokens = value => {
    const text = String(value || '').normalize('NFKC')
        .replace(/[০-৯]/g, digit => String('০১২৩৪৫৬৭৮৯'.indexOf(digit)));
    const tokens = [];
    const pattern = /(?<![\p{L}\p{M}\d.,])((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?![\d,])/gu;
    for (const match of text.matchAll(pattern)) {
        tokens.push({ value: Number(match[1].replace(/,/g, '')), start: match.index, end: match.index + match[0].length, text });
    }
    return tokens;
};

const hasExactNumericValue = (response, expectedValue) => {
    const expected = Number(expectedValue);
    return Number.isFinite(expected) && numericTokens(response).some(token => token.value === expected);
};

const numericAssertionIsNegated = (response, expectedValue) => {
    const expected = Number(expectedValue);
    return numericTokens(response).some(token => {
        if (token.value !== expected) return false;
        const before = token.text.slice(Math.max(0, token.start - 40), token.start).trim();
        const after = token.text.slice(token.end, token.end + 32).trim();
        return /\b(?:not|no|never|wrong|incorrect|isn't|isnt)\b[^.!?;]{0,28}$/i.test(before)
            || /(?:না|নয়|নয়|ভুল)\s*[,;.!?]*$/u.test(before)
            || /^(?:(?:is\s+)?(?:not|wrong|incorrect)|না|নয়|নয়|ভুল)(?=$|[\s,.!?;])/iu.test(after);
    });
};

const responseContainsValue = (response, value) => {
    const normalizedResponse = normalizeForMatch(response);
    const normalizedValue = normalizeForMatch(value);
    if (!normalizedValue) return false;
    if (/^\d+(?:\.\d+)?$/.test(normalizedValue)) {
        return hasExactNumericValue(response, normalizedValue);
    }
    return normalizedResponse.includes(normalizedValue);
};

const stockDisposition = (response, expectedValue) => {
    const text = normalizeForMatch(response);
    const unavailable = /\b(out of stock|not available|unavailable|sold out)\b|স্টকে নেই|মজুদ নেই|পাওয়া যাবে না|পাওয়া যাবে না|স্টক নেই|বিক্রি শেষ/.test(text);
    const available = /\b(in stock|available|stock e ache|stock e ase)\b|স্টকে আছে|স্টকে রয়েছে|স্টকে রয়েছে|মজুদ আছে|পাওয়া যাবে|পাওয়া যাবে|উপলভ্য/.test(text);
    if (expectedValue === 'IN_STOCK') return available && !unavailable;
    if (expectedValue === 'OUT_OF_STOCK') return unavailable;
    return false;
};

const responseContainsFact = ({ response, field, expectedValue, alternateValues = [] }) => {
    if (['stock', 'variant_stock'].includes(field)) return stockDisposition(response, expectedValue);
    if (field === 'price' && numericAssertionIsNegated(response, expectedValue)) return false;
    return [expectedValue, ...alternateValues].some(value => responseContainsValue(response, value));
};

const hasPolicyUncertainty = response => /\b(?:cannot|can't|do not|don't|unable to|not able to)\s+(?:verify|confirm)\b|\b(?:not|no)\s+(?:confirmed|verified)\b|\bdon't\s+have\s+confirmed\s+(?:information|info)\b|নিশ্চিত\s*করতে\s*পারছি\s*না|নিশ্চিত\s*করতে\s*পারব\s*না|তথ্য.{0,16}(?:নেই|পাইনি)|confirm\s+(?:korte\s+)?parchi\s+na|confirmed\s+info\s+amar\s+kache\s+(?:nei|nai)|\b(?:order|delivery)\b.{0,45}\b(?:confirm|create)\b.{0,25}\b(?:parchi\s+na|kora\s+hoyni)\b|ডেলিভারি\s+নিশ্চিত\s+করা\s+হয়নি|ডেলিভারি\s+নিশ্চিত\s+করা\s+হয়নি/iu.test(String(response || ''));
const hasUnsupportedPolicyAssertion = response => /\b(?:free\s+(?:delivery|shipping)|(?:delivery|shipping)\s+(?:is|will be)\s+(?:free|guaranteed)|(?:delivery|shipping)\s+(?:takes?|arrives?|will arrive)\s+(?:within|in|by|today|tomorrow)|(?:delivery|shipping)\s+(?:fee|charge)\s+(?:is|will be|costs?)\s*(?:৳|\d)|(?:cash on delivery|\bCOD\b).{0,24}\b(?:available|accepted|offered|allowed)\b|(?:return|exchange)\s+(?:is|are)\s+(?:available|accepted|allowed))|\bdelivery\s+guaranteed\b/iu.test(String(response || ''));
const hasTeamHandoff = response => /\b(?:someone|our team|a team member)\b.{0,55}\b(?:get back|contact|follow up|reach out)\b|\bplease\s+(?:contact|message|ask)\b.{0,40}\b(?:shop|merchant|team|seller|us)\b|\b(?:amader|shop-er|dokaner)\s+(?:team|shop|seller|representative)\b.{0,55}\b(?:janiye|janabe|janaben|verify|confirm|bolbe|bolben)\b|আমাদের\s+(?:একজন\s+)?(?:প্রতিনিধি|টিম|দল).{0,45}(?:জানিয়ে|জানিয়ে|যোগাযোগ|বলবেন|জানাবেন)|দোকানের\s+সাথে.{0,45}(?:যাচাই|যোগাযোগ|জানাতে\s+হবে|জানাবেন)/iu.test(String(response || ''));

const isSafeCrossDomainHandoff = ({ response, disposition, crossDomainHandoffs, answerableSlots = 0, correctAnsweredSlots = 0 }) => {
    if (!Array.isArray(crossDomainHandoffs) || crossDomainHandoffs.length === 0) return false;
    const text = String(response || '');
    if (hasUnsupportedPolicyAssertion(text)) return false;
    if (disposition === 'SAFE_FALLBACK' && hasTeamHandoff(text)) return true;
    return hasPolicyUncertainty(text) && correctAnsweredSlots === answerableSlots;
};

const isUnnecessaryProductRefusal = ({ response, disposition, answerableSlots = 0, correctAnsweredSlots = 0 }) => {
    if (!Number.isFinite(answerableSlots) || answerableSlots <= 0 || correctAnsweredSlots > 0) return false;
    if (disposition !== 'SEND') return true;
    const text = String(response || '');
    const cannotFindProduct = /\b(?:couldn['’]t|could not|can['’]t|cannot|unable to|not able to)\s+(?:find|locate|identify)\s+(?:(?:that|this|the|any)\s+)?(?:product|item)\b/i.test(text)
        || /\bproduct\b.{0,48}\b(?:couldn['’]t|could not|can['’]t|cannot)\s+(?:find|locate)\b/i.test(text)
        || /(?:পণ্য|প্রোডাক্ট)(?:টি|টা|টিকে)?\s*.{0,48}(?:খুঁজে\s*(?:পাইনি|পাচ্ছি\s*না)|পাওয়া\s*যাচ্ছে\s*না|পাওয়া\s*যাচ্ছে\s*না)/u.test(text)
        || /\bproduct\b.{0,48}(?:pacchi\s+na|paini)/i.test(text);
    return cannotFindProduct;
};

module.exports = {
    normalizeForMatch,
    responseContainsValue,
    responseContainsFact,
    hasPolicyUncertainty,
    hasUnsupportedPolicyAssertion,
    isSafeCrossDomainHandoff,
    isUnnecessaryProductRefusal,
};
