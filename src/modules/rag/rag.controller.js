const ragService = require('./rag.service');
const { AppError } = require('../../utils/AppError');

/**
 * Ingest data into RAG system
 */
const ingestData = async (req, res, next) => {
    try {
        const result = await ragService.ingestData(req.body);

        res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Query RAG system
 */
const queryData = async (req, res, next) => {
    try {
        const shopId = req.user?.shopId;
        const result = await ragService.queryData({
            ...req.body,
            shopId
        });

        res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    ingestData,
    queryData
};
