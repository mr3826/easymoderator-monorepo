# EasyModerator Frontend

A modern, responsive frontend application for customer service automation and moderation.

## 🚀 Features

- **AI-Powered Customer Service**: Intelligent response generation using advanced language models
- **Multi-Channel Support**: Unified communication across WhatsApp, Facebook, Instagram, and more
- **Order Management**: Complete order processing with delivery integration
- **Customer Management**: Advanced customer relationship management with filtering and analytics
- **Knowledge Base**: Dynamic FAQ management and business information handling
- **Campaign Management**: Marketing campaigns with performance tracking
- **Real-time Dashboard**: Comprehensive analytics and business intelligence
- **Subscription Management**: Flexible billing and payment processing

## 🛠 Tech Stack

- **Frontend**: React 18+ with TypeScript, Vite, and Tailwind CSS
- **UI Components**: Modern component library with shadcn/ui
- **State Management**: React hooks for local state and API integration
- **HTTP Client**: Axios-based API client with interceptors
- **Testing**: Vitest for unit and integration testing
- **Build Tools**: Vite for fast development and optimized builds
- **Code Quality**: ESLint and TypeScript for type safety

## 📁 Project Structure

```
src/
├── api/
│   ├── domains/           # Domain-specific API modules
│   │   ├── auth.ts      # Authentication & user management
│   │   ├── product.ts   # Product catalog & categories
│   │   ├── order.ts     # Order processing & delivery
│   │   ├── customer.ts  # Customer management
│   │   ├── channel.ts    # Communication channels
│   │   ├── dashboard.ts  # Analytics & metrics
│   │   ├── knowledge.ts  # Knowledge base & FAQs
│   │   ├── campaign.ts  # Marketing campaigns
│   │   └── subscription.ts # Billing & subscriptions
│   ├── types/            # TypeScript type definitions
│   └── common.ts          # Shared API utilities
├── components/         # Reusable UI components
├── pages/             # Application pages
├── hooks/              # Custom React hooks
├── utils/              # Utility functions
└── styles/             # Global styles
```

## 🔧 API Usage

The application is organized into domain-specific API modules for clean separation of concerns:

### Authentication
```typescript
import { signin, signup, getAuthContext } from '@/api/domains/auth';

// User authentication
const user = await signin({ 
  email: 'user@example.com', 
  password: 'password123' 
});

// Get current session
const context = await getAuthContext();
```

### Product Management
```typescript
import { getProducts, createProduct } from '@/api/domains/product';

// Get products with filtering
const products = await getProducts({ 
  category: 'electronics', 
  page: 1, 
  limit: 10 
});

// Create new product
const newProduct = await createProduct({ 
  name: 'Wireless Headphones', 
  price: 199.99,
  category: 'electronics'
});
```

### Order Processing
```typescript
import { getOrders, createOrder, confirmOrder } from '@/api/domains/order';

// Get orders with filtering
const orders = await getOrders({ 
  status: 'pending', 
  page: 1, 
  limit: 10 
});

// Create and confirm order
const order = await createOrder(orderData);
const confirmed = await confirmOrder(order.id);
```

### Customer Management
```typescript
import { getCustomers, createCustomer, blacklistCustomer } from '@/api/domains/customer';

// Get customers with advanced filtering
const customers = await getCustomers({ 
  status: 'active', 
  page: 1, 
  limit: 20 
});

// Customer blacklisting
await blacklistCustomer('cust123', 'Fraudulent activity');
```

### Channel Integration
```typescript
import { getChannels, createChannel, initiateOAuth } from '@/api/domains/channel';

// Get communication channels
const channels = await getChannels();

// OAuth integration for Facebook
const oauth = await initiateOAuth('facebook');
window.location.href = oauth.redirectUrl;
```

### Dashboard Analytics
```typescript
import { getDashboardMetrics, getAnalytics } from '@/api/domains/dashboard';

// Get performance metrics
const metrics = await getDashboardMetrics(30); // Last 30 days

// Get detailed analytics
const analytics = await getAnalytics(7); // Last 7 days
```

### Knowledge Base
```typescript
import { getKnowledgeSummary, createFaq, updateBusinessInfo } from '@/api/domains/knowledge';

// Get knowledge summary
const summary = await getKnowledgeSummary();

// Create FAQ
const faq = await createFaq({ 
  question: 'What are your hours?', 
  answer: 'We are open 9-5 PM weekdays' 
});

// Update business information
await updateBusinessInfo({ 
  name: 'My Business', 
  description: 'We sell quality products' 
});
```

### Campaign Management
```typescript
import { getCampaigns, createCampaign, scheduleCampaign } from '@/api/domains/campaign';

// Get marketing campaigns
const campaigns = await getCampaigns();

// Create and schedule campaign
const campaign = await createCampaign({
  name: 'Summer Sale',
  type: 'email',
  content: 'Get 20% off all products'
});
await scheduleCampaign(campaign.id, '2024-07-15T10:00:00Z');
```

### Subscription Management
```typescript
import { getSubscription, getSubscriptionPlans, subscribeToPlan } from '@/api/domains/subscription';

// Get current subscription
const subscription = await getSubscription();

// Subscribe to new plan
const plans = await getSubscriptionPlans();
const newSubscription = await subscribeToPlan('plan123', 'yearly');
```

## 🧪 Development

### Prerequisites
- Node.js 18+ and npm
- Modern web browser with ES6+ support

### Getting Started
1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-org/easy-moderator-frontend.git
   cd easy-moderator-frontend
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Environment setup**:
   ```bash
   cp .env.example .env
   # Configure your API endpoints and environment variables
   ```

4. **Start development server**:
   ```bash
   npm run dev
   ```

5. **Build for production**:
   ```bash
   npm run build
   npm run preview
   ```

### Available Scripts
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run test` - Run unit tests
- `npm run lint` - Run ESLint
- `npm run type-check` - Run TypeScript type checking

### Environment Variables
Create a `.env` file based on `.env.example`:
```env
VITE_API_BASE_URL=https://api.example.com
VITE_API_KEY=your-api-key-here
```

## 🧪 Testing

### Running Tests
```bash
# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Test Structure
```
src/
├── api/
│   └── domains/
│       └── __tests__/    # Domain-specific test suites
├── components/
│   └── __tests__/     # Component tests
└── utils/
    └── __tests__/        # Utility function tests
```

## 📚 Documentation

- **API Architecture**: [API_ARCHITECTURE.md](./API_ARCHITECTURE.md) - Detailed API design and architecture
- **API Reference**: [API_REFERENCE.md](./API_REFERENCE.md) - Complete function documentation with examples
- **Component Documentation**: Inline JSDoc comments for all API functions
- **Type Definitions**: Comprehensive TypeScript interfaces in `src/api/types/`

## 🔒 Security

- **Input Validation**: All user inputs are validated and sanitized
- **XSS Protection**: Content Security Policy for dynamic content
- **CSRF Protection**: Built-in CSRF token handling
- **Authentication**: JWT-based authentication with secure token storage
- **API Security**: HTTPS-only communication and secure headers

## 🚀 Deployment

### Production Build
```bash
npm run build
```

The build output will be in the `dist/` directory, optimized for production deployment.

### Environment Configuration
- **Development**: Local development with hot reload
- **Staging**: Pre-production testing environment
- **Production**: Optimized build with environment-specific configuration

## 🤝 Contributing

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Make your changes**: Follow the coding standards and commit patterns
4. **Test thoroughly**: Ensure all tests pass and new functionality works
5. **Submit a pull request**: With clear description and following contribution guidelines

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙋 Support

For support and questions:
- Create an issue in the GitHub repository
- Check the [documentation](./API_REFERENCE.md) for API usage examples
- Review the [architecture guide](./API_ARCHITECTURE.md) for design decisions

---

Built with ❤️ using modern web technologies and best practices.
