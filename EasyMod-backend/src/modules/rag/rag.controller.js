const ragService = require('./rag.service');
const { AppError } = require('../../utils/AppError');

/**
 * Ingest data into RAG system
 */
const ingestData = async (req, res, next) => {
    try {
        const {
            data,
            content_type: contentType,
            collection_id: collectionId,
            metadata = {}
        } = req.body;
        const shopId = req.user?.shopId;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const result = await ragService.ingestData({
            text: data,
            metadata: {
                ...metadata,
                shopId,
                ...(contentType ? { contentType } : {}),
                ...(collectionId ? { collectionId } : {})
            }
        });

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
