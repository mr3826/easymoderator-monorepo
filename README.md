# EasyMod Backend

A production-ready Node.js e-commerce backend with AI-powered customer support, comprehensive payment processing, and multi-tenant architecture.

## 🚀 Features

- **Multi-tenant E-commerce Platform** - Shop management with tenant isolation
- **AI-Powered Customer Support** - RAG-based chatbot with sentiment analysis
- **Comprehensive Payment System** - Multiple Bangladeshi payment gateways (bKash, Nagad)
- **Real-time Communication** - Meta Business Suite integration for customer conversations
- **Inventory Management** - Product catalog with variants and stock tracking
- **Order Processing** - Full order lifecycle with delivery tracking
- **Analytics & Reporting** - Business intelligence and customer insights
- **Subscription Management** - Tiered pricing with usage tracking

## 🏗️ Architecture

### System Overview
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend    │    │   Backend API  │    │   External     │
│   (React)     │◄──►│   (Node.js)    │◄──►│   Services     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │   Data Layer    │
                       │ PostgreSQL      │
                       │ Redis Cache     │
                       │ Vector DBs      │
                       └─────────────────┘
```

### Backend Architecture
```
src/
├── Presentation Layer
│   ├── routes/           # API endpoints
│   └── middleware/      # Request processing
├── Business Logic Layer
│   ├── services/         # Core business logic
│   └── controllers/     # Request handlers
├── Data Access Layer
│   ├── entities/         # Database models
│   └── database/        # Database setup
├── Infrastructure Layer
│   ├── config/           # Configuration
│   ├── utils/            # Utilities
│   └── jobs/            # Background tasks
└── Integration Layer
    ├── integration/       # External APIs
    └── webhooks/         # Webhook handlers
```

## 🛠️ Tech Stack

### Core Technologies
- **Runtime**: Node.js 20 LTS
- **Framework**: Express.js 4.x
- **Database**: PostgreSQL 15
- **Cache**: Redis 7
- **ORM**: Sequelize 6.x

### AI & Vector Storage
- **Vector Database**: Pinecone (primary), Qdrant (fallback)
- **AI Integration**: OpenAI API for chatbot responses
- **Knowledge Base**: RAG implementation with semantic search

### DevOps & Infrastructure
- **Containerization**: Docker with multi-stage builds
- **Process Management**: PM2 clustering
- **CI/CD**: GitHub Actions → Google Cloud Run
- **Monitoring**: Sentry error tracking, custom health checks

### Security & Authentication
- **Authentication**: JWT with refresh tokens
- **Session Management**: Redis-backed sessions
- **CSRF Protection**: Double-submit cookie pattern
- **Rate Limiting**: Redis-based distributed limiting
- **Input Validation**: Express-validator middleware

## 📦 Dependencies

### Production Dependencies
- **Core**: express, sequelize, pg, ioredis
- **Security**: helmet, bcryptjs, jsonwebtoken, csrf-csrf
- **AI/Vectors**: @pinecone-database/pinecone, @qdrant/qdrant-js
- **Payments**: axios (for payment gateway APIs)
- **Monitoring**: @sentry/node
- **Jobs**: bull, bullmq

### Development Dependencies
- **Testing**: jest, supertest, chai, mocha
- **Development**: nodemon, husky
- **Code Quality**: ESLint, Prettier (if configured)

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- PostgreSQL 15+
- Redis 7+
- Docker & Docker Compose (optional)

### Local Development

1. **Clone and Install**
   ```bash
   git clone <repository-url>
   cd EasyMod-backend
   npm install
   ```

2. **Environment Setup**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Database Setup**
   ```bash
   # Using Docker Compose (recommended)
   docker-compose up -d postgres redis qdrant
   
   # Or setup manually
   npm run db:sync
   npm run seed:admin
   ```

4. **Start Development Server**
   ```bash
   npm run dev
   # Server runs on http://localhost:3000
   ```

### Docker Development
```bash
# Start all services
docker-compose up

# Start specific services
docker-compose up postgres redis
npm run dev
```

## 🔧 Configuration

### Environment Variables

#### Required for Production
```bash
DATABASE_URL=postgresql://user:password@host:5432/database
REDIS_URL=redis://host:6379
JWT_ACCESS_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-secret
SESSION_SECRET=your-session-secret
CORS_ORIGINS=https://yourdomain.com
```

#### Optional Configuration
```bash
# AI/Vector DB
PINECONE_API_KEY=your-pinecone-key
PINECONE_INDEX=easymod-knowledge

# Payment Gateways
BKASH_APP_KEY=your-bkash-key
NAGAD_MERCHANT_ID=your-nagad-id

# Monitoring
SENTRY_DSN=your-sentry-dsn
```

## 🧪 Testing

### Run Tests
```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Watch mode
npm run test:watch
```

### Test Structure
```
tests/
├── unit/           # Isolated unit tests
├── integration/     # API endpoint tests
├── features/       # Business workflow tests
└── e2e/          # End-to-end scenarios
```

## 📊 API Documentation

### Authentication
All API endpoints require authentication except:
- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /health`
- `GET /csrf`

### Rate Limiting
- **Authenticated Users**: Based on subscription tier
- **Unauthenticated**: 500 requests per 15 minutes
- **Auth Endpoints**: 10 requests per minute per IP

### Key Endpoints

#### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - User logout

#### Shops
- `GET /api/shop` - List user shops
- `POST /api/shop` - Create new shop
- `PUT /api/shop/:id` - Update shop

#### Products
- `GET /api/product` - List products
- `POST /api/product` - Create product
- `PUT /api/product/:id` - Update product

#### Orders
- `GET /api/order` - List orders
- `POST /api/order` - Create order
- `GET /api/order/:id` - Get order details

#### Conversations
- `GET /api/conversation` - List conversations
- `POST /api/conversation/:id/message` - Send message
- `GET /api/conversation/:id` - Get conversation

## 🚀 Deployment

### Production Deployment

1. **Build Docker Image**
   ```bash
   docker build -t easymod-backend .
   ```

2. **Deploy to Cloud Run**
   ```bash
   # Automated via GitHub Actions
   # Or manually:
   gcloud run deploy easymod-backend --image easymod-backend
   ```

### Environment-Specific Configurations
- **Development**: SQLite fallback allowed, verbose logging
- **Staging**: PostgreSQL required, Redis optional
- **Production**: PostgreSQL + Redis required, security enforced

## 🔒 Security

### Implemented Security Measures
- **JWT Authentication**: Access + refresh token pattern
- **CSRF Protection**: Double-submit cookie implementation
- **Rate Limiting**: Redis-based distributed limiting
- **Input Sanitization**: XSS prevention middleware
- **Security Headers**: Helmet middleware
- **Session Security**: HttpOnly, Secure, SameSite cookies

### Security Best Practices
- All secrets validated for weakness
- Token versioning for password reset invalidation
- Request timeouts prevent DoS attacks
- Error messages sanitized to prevent information disclosure

## 📈 Monitoring & Health

### Health Endpoints
- `GET /health` - Basic health check
- `GET /health/ready` - Readiness probe (checks DB, Redis)
- `GET /health/live` - Liveness probe

### Monitoring Setup
- **Error Tracking**: Sentry integration
- **Performance**: Custom request timing middleware
- **Resource Usage**: PM2 monitoring dashboard
- **Logs**: Structured JSON logging with request IDs

## 🔄 Background Jobs

### Job Processing
- **Queue**: BullMQ with Redis backend
- **Workers**: Message processing, notifications, analytics
- **Retry Logic**: Exponential backoff for failed jobs

### Job Types
- **Message Processing**: AI chatbot responses
- **Notifications**: Push notifications, emails
- **Analytics**: Usage tracking, metrics calculation
- **Cleanup**: Expired sessions, old data

## 🤝 Contributing

### Development Workflow
1. Fork repository
2. Create feature branch
3. Write tests for new functionality
4. Implement changes
5. Ensure all tests pass
6. Submit pull request

### Code Standards
- Use ESLint configuration
- Follow existing code patterns
- Add tests for new features
- Update documentation

## 📝 License

ISC License - see LICENSE file for details

## 🆘 Support

For support and questions:
- Create an issue in the repository
- Check existing documentation
- Review health endpoints for debugging

---

**Last Updated**: May 6, 2026  
**Version**: 1.0.0
