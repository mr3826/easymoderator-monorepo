module.exports = {
  apps: [
    {
      name: 'commerce-ai-api',
      script: './server.js',
      instances: 'max', // Use all available CPU cores
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        DATABASE_URL: 'postgresql://postgres:oN3sKXcA9vFZrQ2mE1Y4D7P8HkWT6M@commerce-ai-db.cvyq4i0wgvgl.ap-south-1.rds.amazonaws.com:5432/commerce_ai',
        REDIS_URL: 'redis://commerce-ai-redis.np2zon.0001.aps1.cache.amazonaws.com:6379',
        CORS_ORIGINS: 'https://your-amplify-app.amplifyapp.com', // Update with your Amplify domain
        JWT_ACCESS_SECRET: '216f6d943d8e87c10f3c3314f34d273ba1cd380e881ce028bb3f19dd58a1b744',
        JWT_REFRESH_SECRET: '113da3ba14d9a5b000a40c5adb445a9d1c45c05b566c94dac2a8e6f1752284a0',
        SESSION_SECRET: 'a215be064624a8a02fb40048561ac279a4c679110c2380c4f75e8919ac7d349a',
        META_APP_ID: 'dummy-meta-app-id',
        META_APP_SECRET: 'dummy-meta-app-secret'
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000
    },
    {
      name: 'commerce-ai-queue-worker',
      script: './src/jobs/worker.js',
      instances: 1, // Single worker instance for job processing
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://postgres:oN3sKXcA9vFZrQ2mE1Y4D7P8HkWT6M@commerce-ai-db.cvyq4i0wgvgl.ap-south-1.rds.amazonaws.com:5432/commerce_ai',
        REDIS_URL: 'redis://commerce-ai-redis.np2zon.0001.aps1.cache.amazonaws.com:6379',
        JWT_ACCESS_SECRET: '216f6d943d8e87c10f3c3314f34d273ba1cd380e881ce028bb3f19dd58a1b744',
        JWT_REFRESH_SECRET: '113da3ba14d9a5b000a40c5adb445a9d1c45c05b566c94dac2a8e6f1752284a0',
        SESSION_SECRET: 'a215be064624a8a02fb40048561ac279a4c679110c2380c4f75e8919ac7d349a',
        META_APP_ID: 'dummy-meta-app-id',
        META_APP_SECRET: 'dummy-meta-app-secret'
      },
      error_file: './logs/worker-err.log',
      out_file: './logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000
    }
  ],

  deploy: {
    production: {
      user: 'ubuntu',
      host: '65.1.84.60',
      ref: 'origin/main',
      repo: 'git@github.com:your-username/commerce-ai-server.git',
      path: '/home/ubuntu/commerce-ai',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
      'pre-setup': ''
    }
  }
};
