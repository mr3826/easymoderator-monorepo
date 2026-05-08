/**
 * Language Switcher Service
 *
 * Detects the language of a text snippet using heuristics:
 *  - Bengali Unicode range (U+0980–U+09FF)
 *  - Latin script ratio
 *  - Common Banglish (Romanised Bengali) word patterns
 *
 * Returns: { language: 'bn' | 'en' | 'banglish', confidence: 0-1 }
 */

// Bengali Unicode block: U+0980–U+09FF
const BENGALI_RANGE = /[\u0980-\u09FF]/g;

// Common Banglish words/patterns — partial list of high-frequency items
const BANGLISH_PATTERNS = [
    /\bami\b/i,      // I
    /\btumi\b/i,     // you (informal)
    /\bapni\b/i,     // you (formal)
    /\bkemon\b/i,    // how
    /\bachen\b/i,    // are (formal)
    /\bacho\b/i,     // are (informal)
    /\bki\b/i,       // what / is
    /\bkore\b/i,     // do/does
    /\bkoro\b/i,     // do
    /\bjanai\b/i,    // know
    /\bjanina\b/i,   // don't know
    /\bdaam\b/i,     // price
    /\bpathao\b/i,   // send
    /\bpabo\b/i,     // will get
    /\bpaben\b/i,    // will get (formal)
    /\bkotha\b/i,    // word / place
    /\bbhai\b/i,     // brother (common term of address)
    /\bapu\b/i,      // sister (term of address)
    /\bvai\b/i,      // variant of bhai
    /\bproduct\b/i,  // common in Banglish commerce context
    /\bdelivery\b/i,
    /\border\b/i
];

/**
 * Count characters matching the given regex in a string.
 * @param {string} text
 * @param {RegExp} re - must use /g flag
 * @returns {number}
 */
const countMatches = (text, re) => (text.match(re) || []).length;

/**
 * Detect the language of the given text.
 *
 * @param {string} text
 * @returns {{ language: 'bn' | 'en' | 'banglish', confidence: number }}
 */
const detectLanguage = (text) => {
    if (!text || typeof text !== 'string') {
        return { language: 'en', confidence: 0 };
    }

    const normalised = text.trim();
    if (!normalised.length) return { language: 'en', confidence: 0 };

    const totalChars = normalised.replace(/\s+/g, '').length || 1;

    // Bengali script characters
    const bengaliChars = countMatches(normalised, BENGALI_RANGE);
    const bengaliRatio = bengaliChars / totalChars;

    // Latin characters (A-Z, a-z)
    const latinChars = countMatches(normalised, /[A-Za-z]/g);
    const latinRatio = latinChars / totalChars;

    // Banglish pattern hits
    const banglishHits = BANGLISH_PATTERNS.filter(re => re.test(normalised)).length;
    const banglishScore = Math.min(banglishHits / 3, 1); // normalise to 0-1, cap at 3 hits

    // Decision logic
    if (bengaliRatio >= 0.4) {
        // Predominantly Bengali script
        return { language: 'bn', confidence: Math.min(0.5 + bengaliRatio * 0.5, 0.99) };
    }

    if (latinRatio >= 0.3 && banglishScore >= 0.33) {
        // Latin letters but strong Banglish word patterns
        const confidence = Math.min(0.5 + banglishScore * 0.4, 0.95);
        return { language: 'banglish', confidence };
    }

    if (latinRatio >= 0.5) {
        // Mostly Latin letters — likely English
        const confidence = Math.min(0.5 + latinRatio * 0.45, 0.95);
        return { language: 'en', confidence };
    }

    // Mixed / ambiguous — default to English with low confidence
    return { language: 'en', confidence: 0.3 };
};

module.exports = { detectLanguage };
