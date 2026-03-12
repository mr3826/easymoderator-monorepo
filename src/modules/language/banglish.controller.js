const banglishService = require('./banglish.service');
const { AppError } = require('../../utils/AppError');

const transliterate = async (req, res) => {
    const { text, use_llm, min_confidence } = req.body;
    if (!text) {
        return res.status(400).json({ success: false, error: 'text is required' });
    }

    const result = await banglishService.transliterate(text, {
        useLlm: use_llm === true,
        minConfidence: min_confidence != null ? Number(min_confidence) : 0.8
    });

    res.json({ success: true, data: result });
};

const learn = async (req, res) => {
    const { banglish, bangla, confidence } = req.body;
    if (!banglish || !bangla) {
        return res.status(400).json({ success: false, error: 'banglish and bangla are required' });
    }

    const result = await banglishService.learnMapping(banglish, bangla, confidence);
    res.json({ success: true, data: result });
};

module.exports = { transliterate, learn };
