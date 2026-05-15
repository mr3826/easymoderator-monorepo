/**
 * Voice Processing Routes
 * 
 * API endpoints for voice message transcription and voice processing configuration
 * All endpoints require authentication
 * 
 * Base path: /api/voice
 * 
 * @file ai/voice-processing.routes.js
 */

const express = require('express');
const voiceProcessingController = require('./voice-processing.controller');
const { authenticate } = require('../../middleware/auth.middleware');

const router = express.Router();

/**
 * All voice processing routes require authentication
 */
router.use(authenticate);

/**
 * POST /api/voice/transcribe
 * Manually transcribe a voice message
 * 
 * Body: { messageId: string, audioBase64: string, language?: 'auto'|'bengali'|'english'|'banglish' }
 * 
 * Response: { success: true, data: { messageId, transcript, language, confidence } }
 */
router.post('/transcribe', voiceProcessingController.transcribe);

/**
 * GET /api/voice/stats
 * Get voice processing statistics for the authenticated shop
 * 
 * Query params: 
 *   - days: number (default 7) - retrieve stats for the last N days
 * 
 * Response: { success: true, data: { transcriptionCount, avgAccuracy, ... } }
 */
router.get('/stats', voiceProcessingController.getStats);

/**
 * POST /api/voice/enable
 * Enable voice processing feature for the authenticated shop
 * 
 * Response: { success: true, data: { voiceProcessingEnabled: true }, message: 'Voice processing enabled' }
 */
router.post('/enable', voiceProcessingController.enable);

/**
 * POST /api/voice/disable
 * Disable voice processing feature for the authenticated shop
 * 
 * Response: { success: true, data: { voiceProcessingEnabled: false }, message: 'Voice processing disabled' }
 */
router.post('/disable', voiceProcessingController.disable);

/**
 * GET /api/voice/config
 * Get voice processing configuration and capabilities
 * 
 * Response: { success: true, data: { voiceProcessingEnabled, supportedLanguages, model, transcriptionChargePerMinute } }
 */
router.get('/config', voiceProcessingController.getConfig);

module.exports = router;
