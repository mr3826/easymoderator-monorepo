'use strict';

/**
 * Standalone Gemini semantic calibration runner.
 *
 * It intentionally imports only the pure retrieval-formatting helper and the
 * controlled fixture corpus. It never imports Qdrant, PostgreSQL, Redis, the
 * application bootstrap, or deployment code. The only external operation is a
 * Gemini embedding request; all ranking and metrics are calculated in memory.
 */

const fs = require('fs');
const {
    prepareRetrievalDocument,
    prepareRetrievalQuery,
} = require('../EasyMod-backend/src/modules/rag/embedding-input');
const {
    POSITIVE_THRESHOLD,
    NEGATIVE_THRESHOLD,
    CALIBRATION_DIMENSIONS,
    DIAGNOSTIC_DIMENSIONS,
    CONTROLLED_FIXTURE_DOCUMENTS,
    CONTROLLED_POSITIVE_QUERIES,
    CONTROLLED_NEGATIVE_QUERIES,
    lexicalOverlapTokens,
    fixtureSearchText,
    validateCalibrationFixtures,
} = require('./semantic-calibration-fixtures');

const DEFAULT_MODEL = 'gemini-embedding-2';
const MAX_DIMENSIONS = 3072;
const TOP_K = 5;

function parseDimensions(value) {
    const rawValues = Array.isArray(value) ? value : String(value || '').split(',');
    const dimensions = [...new Set(rawValues
        .map((raw) => Number.parseInt(String(raw).trim(), 10))
        .filter((dimension) => Number.isInteger(dimension)))];
    if (!dimensions.length || dimensions.some((dimension) => dimension < 1 || dimension > MAX_DIMENSIONS)) {
        throw new Error('calibration dimensions must be integers between 1 and 3072');
    }
    return dimensions;
}

function cosineSimilarity(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) {
        throw new Error('cannot compare embedding vectors with incompatible dimensions');
    }

    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let index = 0; index < left.length; index += 1) {
        const leftValue = Number(left[index]);
        const rightValue = Number(right[index]);
        if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
            throw new Error('embedding vector contains a non-finite value');
        }
        dot += leftValue * rightValue;
        leftNorm += leftValue * leftValue;
        rightNorm += rightValue * rightValue;
    }

    const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
    if (!denominator) throw new Error('cannot compare a zero-norm embedding vector');
    return dot / denominator;
}

function rankDocuments(documents, documentVectors, queryVector) {
    return documents
        .map((document, index) => ({
            fixtureId: document.fixtureId,
            score: cosineSimilarity(queryVector, documentVectors[index]),
        }))
        .sort((left, right) => right.score - left.score || left.fixtureId.localeCompare(right.fixtureId));
}

function percentile(values, fraction) {
    if (!values.length) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const index = (sorted.length - 1) * fraction;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + ((sorted[upper] - sorted[lower]) * (index - lower));
}

function range(values) {
    if (!values.length) return { min: null, median: null, max: null };
    return {
        min: Math.min(...values),
        median: percentile(values, 0.5),
        max: Math.max(...values),
    };
}

function summarizeDimension(positiveCases, negativeCases) {
    const positiveScores = positiveCases
        .map((item) => item.expectedScore)
        .filter((score) => Number.isFinite(score));
    const positiveMargins = positiveCases
        .map((item) => item.top1Margin)
        .filter((margin) => Number.isFinite(margin));
    const negativeTopScores = negativeCases
        .map((item) => item.topScore)
        .filter((score) => Number.isFinite(score));
    const top1Count = positiveCases.filter((item) => item.expectedRank === 1).length;
    const positiveThresholdPassCount = positiveCases.filter((item) => item.pass).length;
    const negativeThresholdPassCount = negativeCases.filter((item) => item.pass).length;
    const positiveExpectedScore = range(positiveScores);
    const positiveTop1Margin = range(positiveMargins);
    const negativeTopScore = range(negativeTopScores);

    return {
        positiveTop1Accuracy: positiveCases.length ? top1Count / positiveCases.length : null,
        positiveThresholdPassRate: positiveCases.length
            ? positiveThresholdPassCount / positiveCases.length
            : null,
        negativeThresholdPassRate: negativeCases.length
            ? negativeThresholdPassCount / negativeCases.length
            : null,
        positiveExpectedScore,
        positiveExpectedScoreMin: positiveExpectedScore.min,
        positiveExpectedScoreMedian: positiveExpectedScore.median,
        positiveExpectedScoreMax: positiveExpectedScore.max,
        positiveTop1Margin,
        positiveTop1MarginMin: positiveTop1Margin.min,
        positiveTop1MarginMedian: positiveTop1Margin.median,
        positiveTop1MarginMax: positiveTop1Margin.max,
        negativeTopScore,
        negativeTopScoreMin: negativeTopScore.min,
        negativeTopScoreMedian: negativeTopScore.median,
        negativeTopScoreMax: negativeTopScore.max,
        negativeTopScorePercentiles: {
            p50: percentile(negativeTopScores, 0.5),
            p90: percentile(negativeTopScores, 0.9),
            p95: percentile(negativeTopScores, 0.95),
        },
    };
}

function classifyCalibration(summary, positiveCases, negativeCases) {
    if (positiveCases.length < 3 || negativeCases.length < 3) {
        return 'CALIBRATION_E_FIXTURE_CORPUS_INSUFFICIENT';
    }
    if (summary.positiveTop1Accuracy === 1 && summary.positiveThresholdPassRate === 1
        && summary.negativeThresholdPassRate === 1) {
        return 'CALIBRATION_A_CURRENT_THRESHOLDS_SUPPORTED_BY_FIXTURE_EVIDENCE';
    }
    if (summary.positiveTop1Accuracy === 1 && summary.positiveThresholdPassRate === 1
        && summary.negativeThresholdPassRate < 1) {
        return 'CALIBRATION_B_NEGATIVE_THRESHOLD_NOT_SUPPORTED';
    }
    if (summary.positiveTop1Accuracy === 1 && summary.positiveThresholdPassRate < 1) {
        return 'CALIBRATION_C_POSITIVE_THRESHOLD_NOT_SUPPORTED';
    }
    if (summary.positiveTop1Accuracy < 1 && summary.negativeThresholdPassRate === 1) {
        return 'CALIBRATION_D_RETRIEVAL_RANKING_QUALITY_PROBLEM';
    }
    return 'CALIBRATION_F_MIXED_FINDINGS';
}

function compareDimensions(resultsByDimension) {
    const calibration = resultsByDimension.find((result) => result.dimensions === CALIBRATION_DIMENSIONS);
    const diagnostic = resultsByDimension.find((result) => result.dimensions === DIAGNOSTIC_DIMENSIONS);
    if (!calibration || !diagnostic) return { status: 'INCONCLUSIVE' };

    const accuracyDelta = diagnostic.summary.positiveTop1Accuracy - calibration.summary.positiveTop1Accuracy;
    const marginDelta = diagnostic.summary.positiveTop1Margin.median - calibration.summary.positiveTop1Margin.median;
    const negativeMedianDelta = diagnostic.summary.negativeTopScore.median - calibration.summary.negativeTopScore.median;
    const negativeMaxDelta = diagnostic.summary.negativeTopScore.max - calibration.summary.negativeTopScore.max;
    const material = Math.abs(accuracyDelta) >= 0.2
        || Math.abs(marginDelta) >= 0.1
        || Math.abs(negativeMedianDelta) >= 0.1
        || Math.abs(negativeMaxDelta) >= 0.1;
    const modest = Math.abs(accuracyDelta) > 0
        || Math.abs(marginDelta) >= 0.05
        || Math.abs(negativeMedianDelta) >= 0.05
        || Math.abs(negativeMaxDelta) >= 0.05;

    return {
        status: material ? 'MATERIAL' : modest ? 'MODEST' : 'NONE',
        accuracyDelta,
        positiveMarginMedianDelta: marginDelta,
        negativeTopScoreMedianDelta: negativeMedianDelta,
        negativeTopScoreMaxDelta: negativeMaxDelta,
        note: 'Dimension comparison is diagnostic evidence only; production remains at 384 dimensions.',
    };
}

function safeApiError(error, status = null) {
    const type = String(error?.name || error?.constructor?.name || 'Error')
        .replace(/[^A-Za-z0-9_.-]/g, '_')
        .slice(0, 80) || 'Error';
    let message = String(error?.message || '')
        .replace(/https?:\/\/[^\s]+/giu, '[url]')
        .replace(/([?&](?:key|token|api[-_]?key|apikey)=)[^&\s]+/giu, '$1[redacted]')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 160);
    if (process.env.GEMINI_API_KEY) message = message.split(process.env.GEMINI_API_KEY).join('[redacted]');
    const detail = message ? ` ${message}` : '';
    return status
        ? `Gemini embedding request failed: ${type} HTTP_${status}${detail}`
        : `Gemini embedding request failed: ${type}${detail}`;
}

async function requestGeminiEmbedding(input, {
    apiKey,
    model = DEFAULT_MODEL,
    dimensions,
    fetchImpl = globalThis.fetch,
}) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is required');
    if (!/^[A-Za-z0-9._-]+$/u.test(model)) throw new Error('GEMINI_EMBEDDING_MODEL is invalid');
    if (typeof fetchImpl !== 'function') throw new Error('global fetch is unavailable');

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`;
    let response;
    try {
        response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: `models/${model}`,
                content: { parts: [{ text: input }] },
                outputDimensionality: dimensions,
            }),
        });
    } catch (error) {
        throw new Error(safeApiError(error));
    }

    if (!response.ok) throw new Error(safeApiError(null, response.status));

    let payload;
    try {
        payload = await response.json();
    } catch (error) {
        throw new Error(safeApiError(error));
    }
    const vector = payload?.embedding?.values;
    if (!Array.isArray(vector) || vector.length !== dimensions || vector.some((value) => !Number.isFinite(Number(value)))) {
        throw new Error('Gemini embedding response had an invalid vector dimension or value');
    }
    return vector.map(Number);
}

async function runDimension({
    documents,
    positiveQueries,
    negativeQueries,
    model,
    dimensions,
    apiKey,
    fetchImpl,
}) {
    const documentVectors = [];
    for (const document of documents) {
        const input = prepareRetrievalDocument(document.content, { title: document.title });
        documentVectors.push(await requestGeminiEmbedding(input, {
            apiKey,
            model,
            dimensions,
            fetchImpl,
        }));
    }

    const positiveCases = [];
    for (const positive of positiveQueries) {
        const queryInput = prepareRetrievalQuery(positive.query);
        const queryVector = await requestGeminiEmbedding(queryInput, {
            apiKey,
            model,
            dimensions,
            fetchImpl,
        });
        const ranked = rankDocuments(documents, documentVectors, queryVector);
        const expectedIndex = ranked.findIndex((result) => result.fixtureId === positive.expectedSourceId);
        const expectedResult = expectedIndex >= 0 ? ranked[expectedIndex] : null;
        const second = ranked[1] || null;
        const top = ranked[0] || null;
        positiveCases.push({
            queryId: positive.queryId,
            languageClass: positive.languageClass,
            query: positive.query,
            expectedSourceId: positive.expectedSourceId,
            expectedFact: positive.expectedFact,
            topSourceId: top?.fixtureId || null,
            expectedSourceExists: expectedIndex >= 0,
            expectedSourceRank: expectedIndex >= 0 ? expectedIndex + 1 : null,
            expectedSourceScore: expectedResult?.score ?? null,
            expectedRank: expectedIndex >= 0 ? expectedIndex + 1 : null,
            expectedScore: expectedResult?.score ?? null,
            topScore: top?.score ?? null,
            secondSourceId: second?.fixtureId || null,
            secondScore: second?.score ?? null,
            top1Margin: top && second ? top.score - second.score : null,
            allScores: ranked,
            topKResults: ranked.slice(0, TOP_K),
            pass: expectedIndex === 0 && Number(expectedResult?.score) >= POSITIVE_THRESHOLD,
        });
    }

    const negativeCases = [];
    for (const negative of negativeQueries) {
        const queryInput = prepareRetrievalQuery(negative.query);
        const queryVector = await requestGeminiEmbedding(queryInput, {
            apiKey,
            model,
            dimensions,
            fetchImpl,
        });
        const ranked = rankDocuments(documents, documentVectors, queryVector);
        const top = ranked[0] || null;
        const second = ranked[1] || null;
        const lexicalOverlap = documents.flatMap((document) => lexicalOverlapTokens(
            negative.query,
            fixtureSearchText(document),
        ));
        negativeCases.push({
            negativeQueryId: negative.negativeQueryId,
            query: negative.query,
            topSourceId: top?.fixtureId || null,
            topScore: top?.score ?? null,
            secondSourceId: second?.fixtureId || null,
            secondScore: second?.score ?? null,
            allScores: ranked,
            topKResults: ranked.slice(0, TOP_K),
            lexicalOverlap: [...new Set(lexicalOverlap)],
            pass: Number(top?.score) < NEGATIVE_THRESHOLD && lexicalOverlap.length === 0,
        });
    }

    const scoreMatrix = {
        positive: positiveCases.map((item) => ({
            queryId: item.queryId,
            expectedSourceId: item.expectedSourceId,
            scores: Object.fromEntries(item.allScores.map((result) => [result.fixtureId, result.score])),
        })),
        negative: negativeCases.map((item) => ({
            negativeQueryId: item.negativeQueryId,
            scores: Object.fromEntries(item.allScores.map((result) => [result.fixtureId, result.score])),
        })),
    };
    const summary = summarizeDimension(positiveCases, negativeCases);

    return {
        dimensions,
        positiveCases,
        negativeCases,
        scoreMatrix,
        summary,
        classification: classifyCalibration(summary, positiveCases, negativeCases),
    };
}

async function runCalibration({
    apiKey,
    model = DEFAULT_MODEL,
    dimensions = [CALIBRATION_DIMENSIONS],
    documents = CONTROLLED_FIXTURE_DOCUMENTS,
    positiveQueries = CONTROLLED_POSITIVE_QUERIES,
    negativeQueries = CONTROLLED_NEGATIVE_QUERIES,
    fetchImpl = globalThis.fetch,
    generatedAt = new Date().toISOString(),
} = {}) {
    validateCalibrationFixtures({ documents, positiveQueries, negativeQueries });
    const normalizedDimensions = parseDimensions(dimensions);
    const resultsByDimension = [];
    for (const dimension of normalizedDimensions) {
        resultsByDimension.push(await runDimension({
            documents,
            positiveQueries,
            negativeQueries,
            model,
            dimensions: dimension,
            apiKey,
            fetchImpl,
        }));
    }

    const artifact = {
        schemaVersion: 1,
        generatedAt,
        provider: 'gemini',
        model,
        positiveThreshold: POSITIVE_THRESHOLD,
        negativeThreshold: NEGATIVE_THRESHOLD,
        formatting: {
            document: 'title: {title} | text: {content}',
            query: 'task: search result | query: {content}',
            outputDimensionality: 'Gemini API outputDimensionality parameter',
        },
        fixtureCorpus: {
            documents: documents.map(({ fixtureId, sourceType, title, authoritativeFacts }) => ({
                fixtureId,
                sourceType,
                title,
                authoritativeFacts,
            })),
            documentCount: documents.length,
            positiveQueryCount: positiveQueries.length,
            negativeQueryCount: negativeQueries.length,
            containsPii: false,
            allPositiveGroundTruthExplicit: true,
            allNegativesLexicallyDisjoint: true,
        },
        resultsByDimension,
        calibration384: resultsByDimension.find((result) => result.dimensions === CALIBRATION_DIMENSIONS) || null,
        diagnostic768: resultsByDimension.find((result) => result.dimensions === DIAGNOSTIC_DIMENSIONS) || null,
        dimensionComparison: compareDimensions(resultsByDimension),
    };

    return artifact;
}

function parseCliArguments(args) {
    const values = {
        dimensions: process.env.CALIBRATION_DIMENSIONS || String(CALIBRATION_DIMENSIONS),
        output: null,
    };
    for (const argument of args) {
        if (argument.startsWith('--dimensions=')) values.dimensions = argument.slice('--dimensions='.length);
        if (argument.startsWith('--output=')) values.output = argument.slice('--output='.length).trim();
    }
    return values;
}

async function main() {
    const { dimensions, output } = parseCliArguments(process.argv.slice(2));
    const artifact = await runCalibration({
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_EMBEDDING_MODEL || DEFAULT_MODEL,
        dimensions: parseDimensions(dimensions),
    });
    const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
    if (output) {
        fs.writeFileSync(output, serialized, { encoding: 'utf8', flag: 'wx' });
    } else {
        process.stdout.write(serialized);
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(`CALIBRATION_FAILED=${safeApiError(error)}`);
        process.exitCode = 1;
    });
}

module.exports = {
    DEFAULT_MODEL,
    parseDimensions,
    cosineSimilarity,
    rankDocuments,
    summarizeDimension,
    classifyCalibration,
    compareDimensions,
    requestGeminiEmbedding,
    runDimension,
    runCalibration,
    parseCliArguments,
};
