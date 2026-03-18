module.exports = {
  apps: [
    {
      name: 'easymod-backend',
      script: './server.js',
      instances: 'max', // Use all available CPU cores
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000,
        // Database configuration
        DB_HOST: process.env.DB_HOST || 'localhost',
        DB_PORT: process.env.DB_PORT || '5432',
        DB_NAME: process.env.DB_NAME || 'easymod_prod',
        DB_USER: process.env.DB_USER || 'easymod_user',
        DB_PASSWORD: process.env.DB_PASSWORD,
        // Redis configuration
        REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
        // Vector DB configuration (Pinecone primary)
        PINECONE_API_KEY: process.env.PINECONE_API_KEY || '',
        PINECONE_INDEX: process.env.PINECONE_INDEX || 'easymod-knowledge',
        PINECONE_NAMESPACE: process.env.PINECONE_NAMESPACE || 'knowledge_base',
        // Qdrant fallback (legacy)
        QDRANT_URL: process.env.QDRANT_URL || 'http://localhost:6333',
        QDRANT_API_KEY: process.env.QDRANT_API_KEY || '',
        // Workflow forwarding
        MAKE_WEBHOOK_URL: process.env.MAKE_WEBHOOK_URL || '',
        MAKE_INTERNAL_AUTH: process.env.MAKE_INTERNAL_AUTH || '',
        // Payment gateway configurations
        BKASH_BASE_URL: process.env.BKASH_BASE_URL || 'https://checkout.bka.sh/v1.2.0-beta',
        BKASH_USERNAME: process.env.BKASH_USERNAME || '',
        BKASH_PASSWORD: process.env.BKASH_PASSWORD || '',
        BKASH_APP_KEY: process.env.BKASH_APP_KEY || '',
        BKASH_APP_SECRET: process.env.BKASH_APP_SECRET || '',
        BKASH_SANDBOX: process.env.BKASH_SANDBOX || 'false',
        NAGAD_BASE_URL: process.env.NAGAD_BASE_URL || 'https://api.mynagad.com/api/v2.0',
        NAGAD_MERCHANT_ID: process.env.NAGAD_MERCHANT_ID || '',
        NAGAD_MERCHANT_NUMBER: process.env.NAGAD_MERCHANT_NUMBER || '',
        NAGAD_PUBLIC_KEY: process.env.NAGAD_PUBLIC_KEY || '',
        NAGAD_PRIVATE_KEY: process.env.NAGAD_PRIVATE_KEY || '',
        NAGAD_SANDBOX: process.env.NAGAD_SANDBOX || 'false',
        // Security
        JWT_SECRET: process.env.JWT_SECRET,
        CSRF_SECRET: process.env.CSRF_SECRET,
        // App configuration
        APP_ADMIN_EMAIL: process.env.APP_ADMIN_EMAIL || 'admin@easymod.tech',
        APP_ADMIN_PASSWORD: process.env.APP_ADMIN_PASSWORD,
        META_WEBHOOK_VERIFY_TOKEN: process.env.META_WEBHOOK_VERIFY_TOKEN
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
      name: 'easymod-queue-worker',
      script: './src/jobs/worker.js',
      instances: 1, // Single worker instance for job processing
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000,
        // Worker-specific environment
        REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
        PINECONE_API_KEY: process.env.PINECONE_API_KEY || '',
        PINECONE_INDEX: process.env.PINECONE_INDEX || 'easymod-knowledge',
        PINECONE_NAMESPACE: process.env.PINECONE_NAMESPACE || 'knowledge_base',
        DB_HOST: process.env.DB_HOST || 'localhost',
        DB_NAME: process.env.DB_NAME || 'easymod_prod',
        DB_USER: process.env.DB_USER || 'easymod_user',
        DB_PASSWORD: process.env.DB_PASSWORD
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
      host: process.env.DEPLOY_HOST || '3.108.44.119',
      ref: 'origin/main',
      repo: 'git@github.com:mr3826/EasyMod-backend.git',
      path: '/home/ubuntu/easymod-backend',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
      'pre-setup': ''
    }
  }
};
