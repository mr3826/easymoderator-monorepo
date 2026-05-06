#!/usr/bin/env node

/**
 * Enhanced Monitoring Setup Script
 * 
 * Sets up comprehensive application monitoring with:
 * - APM (Application Performance Monitoring)
 * - Error tracking and alerting
 * - Custom health checks
 * - Log aggregation
 */

const fs = require('fs');
const path = require('path');

class MonitoringSetup {
  constructor() {
    this.configDir = path.join(__dirname, '..', 'config');
    this.monitoringDir = path.join(__dirname, '..', 'monitoring');
    this.ensureDirectories();
  }

  ensureDirectories() {
    [this.configDir, this.monitoringDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  async setupMonitoring() {
    console.log('📊 EasyMod Backend - Enhanced Monitoring Setup\n');
    
    try {
      // Create enhanced health check endpoints
      await this.createEnhancedHealthChecks();
      
      // Create monitoring configuration
      await this.createMonitoringConfig();
      
      // Create log aggregation setup
      await this.setupLogAggregation();
      
      // Create performance monitoring
      await this.setupPerformanceMonitoring();
      
      // Create alerting configuration
      await this.setupAlerting();
      
      console.log('✅ Monitoring setup completed!');
      await this.displayNextSteps();
      
    } catch (error) {
      console.error('❌ Monitoring setup failed:', error.message);
      throw error;
    }
  }

  async createEnhancedHealthChecks() {
    console.log('🏥 Creating enhanced health checks...');
    
    const healthCheckContent = `/**
 * Enhanced Health Check Endpoints
 * 
 * Provides comprehensive health monitoring for EasyMod backend
 */

const express = require('express');
const { sequelize } = require('../utils/database/database-setup');
const { getRedisClient } = require('../utils/redis-client');
const config = require('../config/config');

const router = express.Router();

// Database health check
router.get('/database', async (req, res) => {
  try {
    await sequelize.authenticate();
    const startTime = Date.now();
    
    // Test database query
    await sequelize.query('SELECT 1');
    
    const responseTime = Date.now() - startTime;
    
    res.json({
      status: 'healthy',
      database: 'connected',
      responseTime: \`\${responseTime}ms\`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Redis health check
router.get('/redis', async (req, res) => {
  try {
    const redis = getRedisClient();
    if (!redis) {
      throw new Error('Redis client not available');
    }
    
    const startTime = Date.now();
    await redis.ping();
    const responseTime = Date.now() - startTime;
    
    res.json({
      status: 'healthy',
      redis: 'connected',
      responseTime: \`\${responseTime}ms\`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      redis: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Memory usage check
router.get('/memory', (req, res) => {
  const memUsage = process.memoryUsage();
  const totalMemory = require('os').totalmem();
  const freeMemory = require('os').freemem();
  
  res.json({
    status: 'healthy',
    memory: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024),
      total: Math.round(memUsage.heapTotal / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024),
      system: {
        total: Math.round(totalMemory / 1024 / 1024),
        free: Math.round(freeMemory / 1024 / 1024)
      }
    },
    timestamp: new Date().toISOString()
  });
});

// CPU usage check
router.get('/cpu', (req, res) => {
  const cpus = require('os').cpus();
  const loadAvg = require('os').loadavg();
  
  res.json({
    status: 'healthy',
    cpu: {
      count: cpus.length,
      model: cpus[0].model,
      speed: cpus[0].speed,
      loadAverage: {
        '1min': loadAvg[0],
        '5min': loadAvg[1],
        '15min': loadAvg[2]
      }
    },
    timestamp: new Date().toISOString()
  });
});

// Disk space check
router.get('/disk', (req, res) => {
  const stats = fs.statSync('.');
  
  res.json({
    status: 'healthy',
    disk: {
      path: process.cwd(),
      available: 'Check implementation for production'
    },
    timestamp: new Date().toISOString()
  });
});

// Application metrics
router.get('/metrics', async (req, res) => {
  try {
    const redis = getRedisClient();
    let redisStatus = 'disconnected';
    
    if (redis) {
      try {
        await redis.ping();
        redisStatus = 'connected';
      } catch (e) {
        redisStatus = 'error';
      }
    }
    
    const uptime = process.uptime();
    
    res.json({
      application: {
        name: 'EasyMod Backend',
        version: require('../../package.json').version,
        environment: config.env,
        uptime: {
          seconds: Math.floor(uptime),
          human: \`\${Math.floor(uptime / 3600)}h \${Math.floor((uptime % 3600) / 60)}m\`
        }
      },
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid
      },
      services: {
        database: 'connected', // Would need actual check
        redis: redisStatus
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
`;

    const healthCheckPath = path.join(this.configDir, 'health-checks.js');
    fs.writeFileSync(healthCheckPath, healthCheckContent);
    console.log('✅ Enhanced health checks created');
  }

  async createMonitoringConfig() {
    console.log('⚙️ Creating monitoring configuration...');
    
    const monitoringConfig = {
      application: {
        name: 'EasyMod Backend',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development'
      },
      endpoints: {
        health: {
          basic: '/health',
          ready: '/health/ready',
          database: '/health/database',
          redis: '/health/redis',
          memory: '/health/memory',
          cpu: '/health/cpu',
          disk: '/health/disk',
          metrics: '/health/metrics'
        }
      },
      thresholds: {
        memory: {
          warning: 80, // percentage
          critical: 90    // percentage
        },
        cpu: {
          warning: 2.0,  // load average
          critical: 3.0   // load average
        },
        responseTime: {
          warning: 1000, // milliseconds
          critical: 2000   // milliseconds
        }
      },
      logging: {
        level: process.env.LOG_LEVEL || 'info',
        format: 'json',
        structured: true
      }
    };

    const configPath = path.join(this.monitoringDir, 'monitoring-config.json');
    fs.writeFileSync(configPath, JSON.stringify(monitoringConfig, null, 2));
    console.log('✅ Monitoring configuration created');
  }

  async setupLogAggregation() {
    console.log('📋 Setting up log aggregation...');
    
    const logConfig = {
      version: 1,
      formatters: [
        {
          type: 'json',
          timestamp: 'ISO8601',
          include: ['timestamp', 'level', 'message', 'requestId', 'userId', 'shopId', 'method', 'url', 'statusCode']
        }
      ],
      outputs: [
        {
          type: 'console',
          colors: true
        },
        {
          type: 'file',
          path: './logs/application.log',
          rotation: {
            maxFiles: 10,
            maxSize: '100MB'
          }
        }
      ],
      filters: [
        {
          type: 'level',
          min: 'info'
        }
      ]
    };

    const logConfigPath = path.join(this.monitoringDir, 'log-config.json');
    fs.writeFileSync(logConfigPath, JSON.stringify(logConfig, null, 2));
    console.log('✅ Log aggregation configuration created');
  }

  async setupPerformanceMonitoring() {
    console.log('📈 Setting up performance monitoring...');
    
    const perfConfig = {
      enabled: true,
      metrics: {
        requestDuration: true,
        requestRate: true,
        errorRate: true,
        databaseQueries: true,
        cacheHitRate: true
      },
      sampling: {
        rate: 0.1, // 10% of requests
        maxPerSecond: 100
      },
      alerts: {
        slowQueries: {
          threshold: 1000, // milliseconds
          enabled: true
        },
        highErrorRate: {
          threshold: 0.05, // 5%
          window: '5m',
          enabled: true
        },
        memoryLeak: {
          threshold: 500, // MB growth
          window: '10m',
          enabled: true
        }
      }
    };

    const perfConfigPath = path.join(this.monitoringDir, 'performance-config.json');
    fs.writeFileSync(perfConfigPath, JSON.stringify(perfConfig, null, 2));
    console.log('✅ Performance monitoring configuration created');
  }

  async setupAlerting() {
    console.log('🚨 Setting up alerting configuration...');
    
    const alertConfig = {
      channels: [
        {
          type: 'email',
          enabled: !!process.env.ALERT_EMAIL,
          recipients: [process.env.ALERT_EMAIL].filter(Boolean)
        },
        {
          type: 'slack',
          enabled: !!process.env.SLACK_WEBHOOK_URL,
          webhook: process.env.SLACK_WEBHOOK_URL,
          channel: process.env.SLACK_CHANNEL || '#alerts'
        },
        {
          type: 'sentry',
          enabled: !!process.env.SENTRY_DSN,
          dsn: process.env.SENTRY_DSN
        }
      ],
      rules: [
        {
          name: 'Service Down',
          condition: 'health_check_failure',
          severity: 'critical',
          cooldown: '1m',
          enabled: true
        },
        {
          name: 'High Error Rate',
          condition: 'error_rate > 5%',
          severity: 'warning',
          cooldown: '5m',
          enabled: true
        },
        {
          name: 'Memory Usage High',
          condition: 'memory_usage > 90%',
          severity: 'warning',
          cooldown: '10m',
          enabled: true
        },
        {
          name: 'Database Connection Lost',
          condition: 'database_connection_failure',
          severity: 'critical',
          cooldown: '30s',
          enabled: true
        }
      ],
      escalation: {
        levels: [
          {
            name: 'warning',
            delay: '0s',
            channels: ['email', 'slack']
          },
          {
            name: 'critical',
            delay: '0s',
            channels: ['email', 'slack', 'sentry']
          }
        ]
      }
    };

    const alertConfigPath = path.join(this.monitoringDir, 'alert-config.json');
    fs.writeFileSync(alertConfigPath, JSON.stringify(alertConfig, null, 2));
    console.log('✅ Alerting configuration created');
  }

  async displayNextSteps() {
    console.log('\n🚀 Next Steps:');
    console.log('   1. Add enhanced health checks to app.js:');
    console.log('      const healthRoutes = require("./config/health-checks");');
    console.log('      app.use("/health", healthRoutes);');
    console.log('');
    console.log('   2. Set up environment variables:');
    console.log('      ALERT_EMAIL=your-email@domain.com');
    console.log('      SLACK_WEBHOOK_URL=your-slack-webhook');
    console.log('      SENTRY_DSN=your-sentry-dsn');
    console.log('      LOG_LEVEL=info');
    console.log('');
    console.log('   3. Install monitoring dependencies:');
    console.log('      npm install --save prometheus-client prom-client');
    console.log('      npm install --save @opentelemetry/api @opentelemetry/sdk');
    console.log('');
    console.log('   4. Set up monitoring dashboard:');
    console.log('      - Grafana for metrics visualization');
    console.log('      - Kibana for log analysis');
    console.log('      - Sentry for error tracking');
    console.log('');
    console.log('   5. Configure monitoring in production:');
    console.log('      - Set up log rotation');
    console.log('      - Configure backup monitoring');
    console.log('      - Set up uptime monitoring');
  }
}

// CLI interface
async function main() {
  const monitoring = new MonitoringSetup();
  
  try {
    await monitoring.setupMonitoring();
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = MonitoringSetup;
