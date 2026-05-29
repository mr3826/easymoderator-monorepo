/**
 * Voice Note Processing Service
 * 
 * Transcribes voice messages to text using Gemini API
 * Supports: Bengali, English, Banglish
 * 
 * Workflow:
 * 1. Detect voice message in conversation
 * 2. Download media file from Meta Graph API
 * 3. Send to Gemini API for transcription
 * 4. Store transcript in conversation
 * 5. Pass text to AI for intent detection
 * 
 * @file ai/voice-processing.service.js
 */

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { Message, Conversation, Customer } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger('VoiceProcessing');

// Gemini API — accept either env name (see llm.service.js note).
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-1.5-flash'; // or gemini-1.5-pro for better quality

/**
 * Process voice message from Meta
 * Downloads audio, transcribes, and updates conversation
 * 
 * @param {string} messageId - Message ID from Meta
 * @param {string} customerId - Customer ID
 * @param {string} shopId - Shop ID
 * @param {Object} mediaData - Media info from webhook
 */
async function processVoiceMessage(messageId, customerId, shopId, mediaData) {
  try {
    logger.info('Processing voice message', { messageId, customerId, shopId });

    // Step 1: Download media from Meta
    const audioBuffer = await downloadMediaFromMeta(mediaData, shopId);

    if (!audioBuffer) {
      throw new AppError('Failed to download voice message', 500);
    }

    // Step 2: Detect language
    const language = await detectLanguage(audioBuffer);

    // Step 3: Transcribe using Gemini
    const transcript = await transcribeWithGemini(audioBuffer, language);

    if (!transcript) {
      throw new AppError('Transcription failed', 500);
    }

    // Step 4: Update message with transcript
    const message = await Message.findByPk(messageId);
    if (message) {
      message.content = transcript;
      message.metadata = message.metadata || {};
      message.metadata.original_type = 'voice';
      message.metadata.language_detected = language;
      message.metadata.transcribed_at = new Date().toISOString();
      message.metadata.confidence = 0.85; // Gemini confidence
      await message.save();

      logger.info('Voice message transcribed', {
        messageId,
        language,
        transcriptLength: transcript.length
      });
    }

    return {
      success: true,
      messageId,
      transcript,
      language,
      length: transcript.length
    };
  } catch (error) {
    logger.error('Error processing voice message', { messageId, error });
    throw error;
  }
}

/**
 * Download media from Meta Graph API
 * Requires access token and media ID
 */
async function downloadMediaFromMeta(mediaData, shopId) {
  try {
    const { mediaId, accessToken } = mediaData;

    if (!mediaId || !accessToken) {
      throw new Error('Missing mediaId or accessToken');
    }

    // Get media URL from Meta
    const mediaResponse = await axios.get(
      `https://graph.instagram.com/v18.0/${mediaId}`,
      {
        params: { fields: 'media_type,media_product_type', access_token: accessToken }
      }
    );

    // Download the actual file
    const downloadResponse = await axios.get(
      `https://graph.instagram.com/v18.0/${mediaId}`,
      {
        params: { fields: 'media_type,media_product_type', access_token: accessToken },
        responseType: 'arraybuffer'
      }
    );

    logger.info('Downloaded media from Meta', { mediaId, size: downloadResponse.data.length });
    return downloadResponse.data;
  } catch (error) {
    logger.error('Error downloading media from Meta', { error });
    throw error;
  }
}

/**
 * Detect language of audio
 * Returns: 'bengali', 'english', 'banglish'
 */
async function detectLanguage(audioBuffer) {
  try {
    // Quick detection using Gemini's language detection
    // Can also use audio characteristics analysis
    // For now, return 'auto' to let Gemini detect

    return 'auto'; // Let Gemini auto-detect
  } catch (error) {
    logger.warn('Error detecting language, defaulting to auto', { error });
    return 'auto';
  }
}

/**
 * Transcribe audio using Gemini API
 * Supports multiple languages and handles Banglish
 * 
 * @param {Buffer} audioBuffer - Audio file data
 * @param {string} language - Language hint (auto, bengali, english, banglish)
 * @returns {Promise<string>} Transcribed text
 */
async function transcribeWithGemini(audioBuffer, language = 'auto') {
  try {
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    // Convert buffer to base64
    const base64Audio = audioBuffer.toString('base64');

    // Determine MIME type (usually audio/mpeg or audio/ogg)
    const mimeType = 'audio/mpeg'; // Can be enhanced to detect actual type

    // Call Gemini API
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Audio
                }
              },
              {
                text: `You are a voice transcription assistant. Your task is to accurately transcribe the audio in the language it is spoken.

${getLanguageHint(language)}

Please transcribe the audio and return ONLY the transcribed text without any additional commentary or markers.`
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.3, // Lower temperature for better accuracy
          maxOutputTokens: 1024,
          topP: 0.95,
          topK: 40
        }
      },
      {
        headers: {
          'Content-Type': 'application/json'
        },
        params: {
          key: GEMINI_API_KEY
        }
      }
    );

    const transcript = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!transcript) {
      throw new Error('No transcription received from Gemini');
    }

    logger.info('Gemini transcription successful', {
      language,
      outputLength: transcript.length
    });

    return transcript.trim();
  } catch (error) {
    logger.error('Error calling Gemini API', { error, language });
    throw new AppError(`Transcription failed: ${error.message}`, 500);
  }
}

/**
 * Get language hint for Gemini prompt
 */
function getLanguageHint(language) {
  const hints = {
    bengali: 'The audio is in Bengali language. Transcribe exactly as spoken, preserving Bengali script.',
    english: 'The audio is in English. Transcribe word-for-word.',
    banglish: 'The audio contains Banglish (romanized Bengali). Transcribe phonetically as spoken.',
    auto: 'The audio may be in Bengali, English, or Banglish. Transcribe accurately in the language detected. If Banglish is detected, provide the romanized text exactly as spoken.'
  };

  return hints[language] || hints.auto;
}

/**
 * Process voice message in a conversation
 * Used by conversation workflow
 */
async function processVoiceInConversation(conversationId, voiceMessage) {
  try {
    const conversation = await Conversation.findByPk(conversationId);

    if (!conversation) {
      throw new AppError('Conversation not found', 404);
    }

    // Extract media data
    const mediaData = voiceMessage.media || {};
    const language = voiceMessage.language || 'auto';

    // Transcribe
    const transcript = await transcribeWithGemini(voiceMessage.buffer, language);

    // Update conversation
    conversation.message = transcript;
    conversation.metadata = conversation.metadata || {};
    conversation.metadata.voice_transcribed = true;
    conversation.metadata.original_voice_length = voiceMessage.duration || 0;
    conversation.metadata.language_detected = language;
    await conversation.save();

    logger.info('Voice message processed in conversation', {
      conversationId,
      transcriptLength: transcript.length
    });

    return {
      success: true,
      conversationId,
      transcript,
      language
    };
  } catch (error) {
    logger.error('Error processing voice in conversation', { conversationId, error });
    throw error;
  }
}

/**
 * Enable/disable voice processing for a shop
 */
async function configureVoiceProcessing(shopId, enabled) {
  try {
    const shop = require('../entities').Shop;
    const shopRecord = await shop.findByPk(shopId);

    if (!shopRecord) {
      throw new AppError('Shop not found', 404);
    }

    shopRecord.settings = shopRecord.settings || {};
    shopRecord.settings.ai = shopRecord.settings.ai || {};
    shopRecord.settings.ai.voice_processing_enabled = enabled;
    await shopRecord.save();

    logger.info('Voice processing configuration updated', { shopId, enabled });

    return {
      success: true,
      voiceProcessingEnabled: enabled
    };
  } catch (error) {
    logger.error('Error configuring voice processing', { shopId, error });
    throw error;
  }
}

/**
 * Get voice processing statistics
 */
async function getVoiceProcessingStats(shopId, days = 7) {
  try {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const messages = await Message.findAll({
      include: [
        {
          model: Conversation,
          where: { shop_id: shopId },
          attributes: []
        }
      ],
      where: {
        createdAt: { [require('sequelize').Op.gte]: startDate },
        metadata: { [require('sequelize').Op.like]: '%voice%' }
      },
      attributes: ['id', 'metadata', 'createdAt']
    });

    const totalVoiceMessages = messages.length;
    const languageStats = {};
    let totalDuration = 0;

    messages.forEach(msg => {
      if (msg.metadata?.language_detected) {
        languageStats[msg.metadata.language_detected] = 
          (languageStats[msg.metadata.language_detected] || 0) + 1;
      }
      totalDuration += msg.metadata?.original_voice_length || 0;
    });

    return {
      period: `${days} days`,
      totalVoiceMessages,
      languageBreakdown: languageStats,
      totalDurationSeconds: totalDuration,
      averageMessageLength: totalVoiceMessages > 0 ? totalDuration / totalVoiceMessages : 0
    };
  } catch (error) {
    logger.error('Error getting voice processing stats', { shopId, error });
    throw error;
  }
}

module.exports = {
  processVoiceMessage,
  processVoiceInConversation,
  transcribeWithGemini,
  detectLanguage,
  configureVoiceProcessing,
  getVoiceProcessingStats
};
