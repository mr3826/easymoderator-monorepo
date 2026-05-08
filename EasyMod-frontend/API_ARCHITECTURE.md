# API Architecture Documentation

## Overview

This document describes the architecture and design principles of the EasyModerator frontend API layer. The API is organized into domain-specific modules that provide a clean, type-safe interface to backend services.

## Architecture Principles

### 1. Domain-Driven Design
The API is organized by business domains, each containing related functionality:
- **Auth**: Authentication, user management, and shop configuration
- **Product**: Product and category management with AI-powered extraction
- **Order**: Order processing, delivery management, and courier integration
- **Customer**: Customer management with filtering and blacklisting
- **Channel**: Communication channels and social media integrations
- **Dashboard**: Analytics, metrics, and knowledge gap analysis
- **Knowledge**: FAQ management, business info, and document storage
- **Campaign**: Marketing campaigns and performance tracking
- **Subscription**: Billing, payment methods, and plan management

### 2. Consistent HTTP Patterns
- **RESTful endpoints**: Using standard HTTP methods (GET, POST, PATCH, DELETE)
- **Singular nouns**: Endpoints use singular form (e.g., `/product`, `/order`)
- **Resource nesting**: Related operations use nested paths (e.g., `/order/{id}/confirm`)
- **Standardized responses**: All endpoints return `ApiResponse<T>` wrapper

### 3. Type Safety
- **TypeScript interfaces**: All API requests and responses are fully typed
- **Generic response wrapper**: `ApiResponse<T>` ensures consistent response structure
- **Domain-specific types**: Each domain has its own type definitions
- **Error handling**: Consistent error types and HTTP status codes

### 4. Client Architecture
- **Axios-based HTTP client**: Centralized HTTP client with interceptors
- **Response transformation**: Automatic extraction of `response.data.data`
- **Authentication handling**: Built-in token management and CSRF protection
- **Error interceptors**: Centralized error handling and logging

## Domain Structure

### Auth Domain (`/src/api/domains/auth.ts`)
**Purpose**: User authentication and session management
**Key Functions**:
- `signin()` - User login with credentials
- `signup()` - New user registration
- `forgotPassword()` - Password recovery initiation
- `resetPassword()` - Password reset completion
- `logout()` - Session termination
- `getAuthContext()` - Current user session info
- `refreshToken()` - Access token renewal
- Shop management functions for multi-tenant support

### Product Domain (`/src/api/domains/product.ts`)
**Purpose**: Product catalog and category management
**Key Functions**:
- `getProducts()` - Product listing with filtering and pagination
- `getProduct()` - Single product retrieval
- `createProduct()` - New product creation
- `updateProduct()` - Product modification
- `deleteProduct()` - Product removal
- `extractProductsFromUpload()` - AI-powered product extraction from uploads
- Category management functions
- `getSubcategoryDetails()` - Hierarchical category information

### Order Domain (`/src/api/domains/order.ts`)
**Purpose**: Order processing and fulfillment
**Key Functions**:
- `getOrders()` - Order listing with filtering
- `getOrder()` - Single order retrieval
- `createOrder()` - New order creation
- `updateOrder()` - Order modification
- `confirmOrder()` - Order confirmation for processing
- `cancelOrder()` - Order cancellation with reason
- `bookCourier()` - Delivery booking integration
- Delivery settings and provider management

### Customer Domain (`/src/api/domains/customer.ts`)
**Purpose**: Customer relationship management
**Key Functions**:
- `getCustomers()` - Customer listing with advanced filtering
- `getCustomer()` - Single customer retrieval
- `createCustomer()` - New customer creation
- `updateCustomer()` - Customer information updates
- `blacklistCustomer()` - Customer blacklisting with reason
- `removeFromBlacklist()` - Blacklist removal

### Channel Domain (`/src/api/domains/channel.ts`)
**Purpose**: Communication channel management and integrations
**Key Functions**:
- `getChannels()` - Channel listing
- `getChannel()` - Single channel retrieval
- `createChannel()` - New channel setup
- `updateChannel()` - Channel configuration
- `deleteChannel()` - Channel removal
- OAuth integration for Facebook/Instagram
- `testChannelPipeline()` - Channel functionality testing
- `subscribeChannelWebhooks()` - Webhook configuration

### Dashboard Domain (`/src/api/domains/dashboard.ts`)
**Purpose**: Analytics and business intelligence
**Key Functions**:
- `getDashboardMetrics()` - Key performance indicators
- `getDashboardQueue()` - Processing queue information
- `getKnowledgeGaps()` - Knowledge base analysis
- `getAnalytics()` - Detailed usage analytics

### Knowledge Domain (`/src/api/domains/knowledge.ts`)
**Purpose**: Knowledge base and FAQ management
**Key Functions**:
- `getKnowledgeSummary()` - Knowledge base overview
- `updateBusinessInfo()` - Business information management
- `updateBrandingRules()` - Content guidelines configuration
- FAQ CRUD operations
- `listKnowledgeGaps()` - Knowledge gap identification
- Document management with AI-powered content

### Campaign Domain (`/src/api/domains/campaign.ts`)
**Purpose**: Marketing campaign management
**Key Functions**:
- `getCampaigns()` - Campaign listing
- `getCampaign()` - Single campaign retrieval
- `createCampaign()` - Campaign creation
- `updateCampaign()` - Campaign modification
- `scheduleCampaign()` - Campaign scheduling
- `launchCampaign()` - Immediate campaign execution
- `getCampaignStats()` - Performance analytics

### Subscription Domain (`/src/api/domains/subscription.ts`)
**Purpose**: Billing and subscription management
**Key Functions**:
- `getSubscription()` - Current subscription details
- `getSubscriptionPlans()` - Available plan listing
- `subscribeToPlan()` - Plan subscription
- `cancelSubscription()` - Subscription cancellation
- `reactivateSubscription()` - Subscription restoration
- Payment method management
- Invoice history and retrieval

## Response Structure

### Standard API Response
```typescript
interface ApiResponse<T> {
  data: T;           // Actual response data
  message?: string;     // Optional success/error message
  success?: boolean;   // Success indicator
}
```

### Error Handling
- **HTTP status codes**: Standard RESTful status codes
- **Error responses**: Consistent error message format
- **Client-side errors**: Validation and network error handling
- **Server errors**: Proper error propagation and logging

## Security Considerations

### Authentication
- **JWT tokens**: Bearer token authentication
- **CSRF protection**: Built-in CSRF token handling
- **Session management**: Automatic token refresh
- **Multi-tenant support**: Shop-based isolation

### Data Validation
- **TypeScript validation**: Compile-time type checking
- **Runtime validation**: Request/response validation
- **Sanitization**: Input data sanitization
- **Error boundaries**: Graceful error handling

## Performance Optimizations

### Caching Strategy
- **Response caching**: Intelligent response caching
- **Request deduplication**: Prevent duplicate requests
- **Lazy loading**: On-demand data loading
- **Pagination support**: Efficient data pagination

### Bundle Optimization
- **Tree shaking**: Unused code elimination
- **Code splitting**: Domain-based code separation
- **Lazy imports**: Dynamic module loading
- **Minification**: Production build optimization

## Integration Points

### Backend Integration
- **Base URL configuration**: Environment-specific endpoints
- **API versioning**: Version-aware routing
- **Environment variables**: Secure configuration management
- **Proxy support**: Development proxy configuration

### Third-party Services
- **OAuth providers**: Social media authentication
- **Payment gateways**: Multiple payment provider support
- **Courier services**: Delivery integration APIs
- **AI services**: Product extraction and content generation

## Development Guidelines

### Code Standards
- **Consistent naming**: Function and variable naming conventions
- **JSDoc documentation**: Comprehensive function documentation
- **Type annotations**: Full TypeScript type coverage
- **Error handling**: Proper error propagation

### Testing Strategy
- **Unit tests**: Comprehensive function testing
- **Integration tests**: API endpoint testing
- **Mock responses**: Consistent test data
- **Error scenarios**: Edge case coverage

### Deployment Considerations
- **Environment configuration**: Development/staging/production setups
- **API versioning**: Backward compatibility
- **Monitoring**: Performance and error tracking
- **Documentation**: Always up-to-date API docs

## Future Enhancements

### Planned Improvements
- **GraphQL integration**: Query optimization
- **Real-time updates**: WebSocket integration
- **Offline support**: Service worker implementation
- **Advanced caching**: Redis integration

### Scalability Considerations
- **Microservices**: Service decomposition
- **Load balancing**: Request distribution
- **Database optimization**: Query performance
- **CDN integration**: Asset delivery optimization
