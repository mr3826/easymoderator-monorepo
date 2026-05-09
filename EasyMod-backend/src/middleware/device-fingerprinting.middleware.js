const crypto = require('crypto');
const { UserDevice } = require('../modules/entities');

/**
 * Generate device fingerprint from request headers and client info
 */
const generateDeviceFingerprint = (req) => {
  const userAgent = req.get('User-Agent') || '';
  const acceptLanguage = req.get('Accept-Language') || '';
  const acceptEncoding = req.get('Accept-Encoding') || '';
  const ip = req.ip || req.connection.remoteAddress || '';
  
  // Create a consistent fingerprint from available headers
  const fingerprintData = `${userAgent}|${acceptLanguage}|${acceptEncoding}|${ip}`;
  return crypto.createHash('sha256').update(fingerprintData).digest('hex');
};

/**
 * Device fingerprinting middleware
 * Tracks user sessions and enforces concurrent session limits
 */
const deviceFingerprinting = async (req, res, next) => {
  const { ENABLE_DEVICE_FINGERPRINTING, MAX_CONCURRENT_SESSIONS } = process.env;
  
  // Skip if device fingerprinting is disabled
  if (ENABLE_DEVICE_FINGERPRINTING !== 'true') {
    return next();
  }

  try {
    const deviceFingerprint = generateDeviceFingerprint(req);
    const userId = req.user?.id;

    // For authenticated requests, track device usage
    if (userId) {
      const maxSessions = parseInt(MAX_CONCURRENT_SESSIONS) || 5;
      
      // Find or create device record
      const [device, created] = await UserDevice.findOrCreate({
        where: {
          user_id: userId,
          device_fingerprint: deviceFingerprint
        },
        defaults: {
          user_id: userId,
          device_fingerprint: deviceFingerprint,
          device_name: extractDeviceName(req.get('User-Agent')),
          user_agent: req.get('User-Agent'),
          ip_address: req.ip,
          is_active: true,
          last_seen_at: new Date()
        }
      });

      // Update device info if it already exists
      if (!created) {
        await device.update({
          last_seen_at: new Date(),
          ip_address: req.ip,
          is_active: true
        });
      }

      // Check concurrent session limit
      const activeDeviceCount = await UserDevice.count({
        where: {
          user_id: userId,
          is_active: true
        }
      });

      if (activeDeviceCount > maxSessions) {
        // Deactivate oldest session
        const oldestDevice = await UserDevice.findOne({
          where: {
            user_id: userId,
            is_active: true
          },
          order: [['last_seen_at', 'ASC']]
        });

        if (oldestDevice && oldestDevice.device_fingerprint !== deviceFingerprint) {
          await oldestDevice.update({ is_active: false });
          
          // Blacklist tokens from this device (optional - would require token tracking)
          console.log(`Deactivated oldest device session for user ${userId} due to limit`);
        }
      }
    }

    // Add device info to request for logging
    req.deviceFingerprint = deviceFingerprint;
    req.deviceName = extractDeviceName(req.get('User-Agent'));
    
    next();
  } catch (error) {
    console.error('Device fingerprinting error:', error);
    next(); // Continue without device tracking on error
  }
};

/**
 * Extract device name from User-Agent string
 */
const extractDeviceName = (userAgent) => {
  if (!userAgent) return 'Unknown Device';
  
  // Simple device name extraction
  if (userAgent.includes('Mobile')) return 'Mobile';
  if (userAgent.includes('Tablet')) return 'Tablet';
  if (userAgent.includes('Chrome')) return 'Chrome';
  if (userAgent.includes('Firefox')) return 'Firefox';
  if (userAgent.includes('Safari')) return 'Safari';
  if (userAgent.includes('Edge')) return 'Edge';
  
  return 'Desktop';
};

module.exports = { deviceFingerprinting, generateDeviceFingerprint };
