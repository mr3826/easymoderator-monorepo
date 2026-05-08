# API Reference Documentation

## Overview

This document provides a comprehensive reference for all EasyModerator frontend API functions. Each function includes parameters, return types, error handling, and usage examples.

## Authentication Functions

### `signin(credentials)`
**Purpose**: Authenticate user with email and password
**Parameters**:
- `credentials: SigninRequest` - User signin credentials containing email and password
**Returns**: `Promise<AuthResponse>` - Authentication response with user data and tokens
**Throws**: `Error` - When signin fails due to invalid credentials or network issues
**Example**:
```typescript
import { signin } from '@/api/domains/auth';

const result = await signin({ 
  email: 'user@example.com', 
  password: 'password123' 
});
console.log('User authenticated:', result.user.name);
```

### `signup(credentials)`
**Purpose**: Register new user account
**Parameters**:
- `credentials: SignupRequest` - User registration data including email, password, and profile info
**Returns**: `Promise<AuthResponse>` - Authentication response with user data and tokens
**Throws**: `Error` - When signup fails due to validation or network issues
**Example**:
```typescript
import { signup } from '@/api/domains/auth';

const result = await signup({ 
  email: 'newuser@example.com', 
  password: 'password123',
  name: 'John Doe'
});
console.log('User registered:', result.user.id);
```

### `forgotPassword(email)`
**Purpose**: Initiate password recovery process
**Parameters**:
- `email: string` - User email address for password reset
**Returns**: `Promise<void>` - Resolves when reset email is sent
**Throws**: `Error` - When password reset initiation fails
**Example**:
```typescript
import { forgotPassword } from '@/api/domains/auth';

await forgotPassword('user@example.com');
console.log('Password reset email sent');
```

### `resetPassword(token, password)`
**Purpose**: Complete password reset with token
**Parameters**:
- `token: string` - Password reset token from email
- `password: string` - New password for the account
**Returns**: `Promise<void>` - Resolves when password is successfully reset
**Throws**: `Error` - When password reset fails due to invalid token or network issues
**Example**:
```typescript
import { resetPassword } from '@/api/domains/auth';

await resetPassword('reset-token-123', 'newPassword456');
console.log('Password reset successful');
```

### `logout()`
**Purpose**: Terminate user session
**Parameters**: None
**Returns**: `Promise<void>` - Resolves when logout completes
**Throws**: `Error` - When logout fails
**Example**:
```typescript
import { logout } from '@/api/domains/auth';

await logout();
console.log('User logged out');
```

### `getAuthContext()`
**Purpose**: Get current authentication context
**Parameters**: None
**Returns**: `Promise<AuthContext>` - Current user session information
**Throws**: `Error` - When auth context retrieval fails
**Example**:
```typescript
import { getAuthContext } from '@/api/domains/auth';

const context = await getAuthContext();
console.log('Current user:', context.user.name);
```

### `refreshToken()`
**Purpose**: Refresh access token
**Parameters**: None
**Returns**: `Promise<AuthResponse>` - New authentication tokens
**Throws**: `Error` - When token refresh fails
**Example**:
```typescript
import { refreshToken } from '@/api/domains/auth';

const tokens = await refreshToken();
console.log('New access token:', tokens.accessToken);
```

## Product Functions

### `getProducts(params?)`
**Purpose**: Get all products with optional filtering and pagination
**Parameters**:
- `params?: Record<string, unknown>` - Optional query parameters for filtering, pagination, and sorting
**Returns**: `Promise<Product[]>` - Array of products
**Throws**: `Error` - When product retrieval fails
**Example**:
```typescript
import { getProducts } from '@/api/domains/product';

const products = await getProducts({ 
  category: 'electronics', 
  page: 1, 
  limit: 10 
});
console.log('Products found:', products.length);
```

### `getProduct(productId)`
**Purpose**: Get single product by ID
**Parameters**:
- `productId: string` - Unique identifier of product to retrieve
**Returns**: `Promise<Product>` - Product object
**Throws**: `Error` - When product not found or retrieval fails
**Example**:
```typescript
import { getProduct } from '@/api/domains/product';

const product = await getProduct('prod123');
console.log('Product name:', product.name);
```

### `createProduct(product)`
**Purpose**: Create new product
**Parameters**:
- `product: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>` - Product data without auto-generated fields
**Returns**: `Promise<Product>` - Created product object
**Throws**: `Error` - When product creation fails due to validation or network issues
**Example**:
```typescript
import { createProduct } from '@/api/domains/product';

const newProduct = await createProduct({ 
  name: 'Wireless Headphones', 
  price: 199.99,
  category: 'electronics'
});
console.log('Product created:', newProduct.id);
```

### `updateProduct(productId, updates)`
**Purpose**: Update existing product
**Parameters**:
- `productId: string` - ID of product to update
- `updates: Partial<Product>` - Partial product data with fields to update
**Returns**: `Promise<Product>` - Updated product object
**Throws**: `Error` - When product update fails due to invalid ID or permissions
**Example**:
```typescript
import { updateProduct } from '@/api/domains/product';

const updated = await updateProduct('prod123', { 
  price: 179.99,
  description: 'Updated description'
});
console.log('Product updated:', updated.price);
```

### `deleteProduct(productId)`
**Purpose**: Delete product by ID
**Parameters**:
- `productId: string` - ID of product to delete
**Returns**: `Promise<void>` - Resolves when deletion completes
**Throws**: `Error` - When product deletion fails due to invalid ID or permissions
**Example**:
```typescript
import { deleteProduct } from '@/api/domains/product';

await deleteProduct('prod123');
console.log('Product deleted');
```

### `extractProductsFromUpload(file)`
**Purpose**: Extract products from uploaded file using AI
**Parameters**:
- `file: File` - File containing product data to extract
**Returns**: `Promise<Product[]>` - Array of extracted products
**Throws**: `Error` - When product extraction fails
**Example**:
```typescript
import { extractProductsFromUpload } from '@/api/domains/product';

const fileInput = document.getElementById('fileInput').files[0];
const products = await extractProductsFromUpload(fileInput);
console.log('Extracted products:', products.length);
```

### `getCategories(params?)`
**Purpose**: Get all product categories with optional filtering
**Parameters**:
- `params?: Record<string, unknown>` - Optional query parameters for filtering and pagination
**Returns**: `Promise<Category[]>` - Array of categories
**Throws**: `Error` - When category retrieval fails
**Example**:
```typescript
import { getCategories } from '@/api/domains/product';

const categories = await getCategories({ page: 1, limit: 20 });
console.log('Categories found:', categories.length);
```

### `getCategory(categoryId)`
**Purpose**: Get single category by ID
**Parameters**:
- `categoryId: string` - Unique identifier of category to retrieve
**Returns**: `Promise<Category>` - Category object
**Throws**: `Error` - When category not found or retrieval fails
**Example**:
```typescript
import { getCategory } from '@/api/domains/product';

const category = await getCategory('cat123');
console.log('Category name:', category.name);
```

### `createCategory(category)`
**Purpose**: Create new product category
**Parameters**:
- `category: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>` - Category data without auto-generated fields
**Returns**: `Promise<Category>` - Created category object
**Throws**: `Error` - When category creation fails due to validation or network issues
**Example**:
```typescript
import { createCategory } from '@/api/domains/product';

const newCategory = await createCategory({ 
  name: 'Electronics', 
  description: 'Electronic devices and accessories'
});
console.log('Category created:', newCategory.id);
```

### `updateCategory(categoryId, updates)`
**Purpose**: Update existing category
**Parameters**:
- `categoryId: string` - ID of category to update
- `updates: Partial<Category>` - Partial category data with fields to update
**Returns**: `Promise<Category>` - Updated category object
**Throws**: `Error` - When category update fails due to invalid ID or permissions
**Example**:
```typescript
import { updateCategory } from '@/api/domains/product';

const updated = await updateCategory('cat123', { 
  description: 'Updated category description'
});
console.log('Category updated:', updated.name);
```

### `deleteCategory(categoryId)`
**Purpose**: Delete category by ID
**Parameters**:
- `categoryId: string` - ID of category to delete
**Returns**: `Promise<void>` - Resolves when deletion completes
**Throws**: `Error` - When category deletion fails due to invalid ID or permissions
**Example**:
```typescript
import { deleteCategory } from '@/api/domains/product';

await deleteCategory('cat123');
console.log('Category deleted');
```

### `getSubcategoryDetails(categoryId)`
**Purpose**: Get detailed information about a category including subcategories
**Parameters**:
- `categoryId: string` - ID of category to get details for
**Returns**: `Promise<Category>` - Category object with subcategory details
**Throws**: `Error` - When category details retrieval fails
**Example**:
```typescript
import { getSubcategoryDetails } from '@/api/domains/product';

const details = await getSubcategoryDetails('cat123');
console.log('Subcategories:', details.subcategories?.length);
```

## Order Functions

### `getOrders(params?)`
**Purpose**: Get all orders with optional filtering and pagination
**Parameters**:
- `params?: Record<string, unknown>` - Optional query parameters for filtering, pagination, and sorting
**Returns**: `Promise<Order[]>` - Array of orders
**Throws**: `Error` - When order retrieval fails
**Example**:
```typescript
import { getOrders } from '@/api/domains/order';

const orders = await getOrders({ 
  status: 'pending', 
  page: 1, 
  limit: 10 
});
console.log('Orders found:', orders.length);
```

### `getOrder(orderId)`
**Purpose**: Get single order by ID
**Parameters**:
- `orderId: string` - Unique identifier of order to retrieve
**Returns**: `Promise<Order>` - Order object
**Throws**: `Error` - When order not found or retrieval fails
**Example**:
```typescript
import { getOrder } from '@/api/domains/order';

const order = await getOrder('order123');
console.log('Order status:', order.status);
```

### `createOrder(order)`
**Purpose**: Create new order
**Parameters**:
- `order: Omit<Order, 'id' | 'createdAt' | 'updatedAt'>` - Order data without auto-generated fields
**Returns**: `Promise<Order>` - Created order object
**Throws**: `Error` - When order creation fails due to validation or network issues
**Example**:
```typescript
import { createOrder } from '@/api/domains/order';

const newOrder = await createOrder({ 
  customer_id: 'cust123', 
  items: [{ product_id: 'prod1', quantity: 2 }],
  total: 199.99 
});
console.log('Order created:', newOrder.id);
```

### `updateOrder(orderId, order)`
**Purpose**: Update existing order
**Parameters**:
- `orderId: string` - ID of order to update
- `order: Partial<Order>` - Partial order data with fields to update
**Returns**: `Promise<Order>` - Updated order object
**Throws**: `Error` - When order update fails due to invalid ID or permissions
**Example**:
```typescript
import { updateOrder } from '@/api/domains/order';

const updated = await updateOrder('order123', { 
  status: 'confirmed',
  shipping_address: '123 Main St'
});
console.log('Order updated:', updated.status);
```

### `confirmOrder(orderId)`
**Purpose**: Confirm order for processing
**Parameters**:
- `orderId: string` - ID of order to confirm
**Returns**: `Promise<Order>` - Confirmed order object
**Throws**: `Error` - When order confirmation fails
**Example**:
```typescript
import { confirmOrder } from '@/api/domains/order';

const confirmed = await confirmOrder('order123');
console.log('Order confirmed:', confirmed.id);
```

### `cancelOrder(orderId, reason?)`
**Purpose**: Cancel order with optional reason
**Parameters**:
- `orderId: string` - ID of order to cancel
- `reason?: string` - Optional reason for cancellation
**Returns**: `Promise<Order>` - Cancelled order object
**Throws**: `Error` - When order cancellation fails
**Example**:
```typescript
import { cancelOrder } from '@/api/domains/order';

const cancelled = await cancelOrder('order123', 'Customer requested');
console.log('Order cancelled:', cancelled.status);
```

### `bookCourier(orderId, payload)`
**Purpose**: Book courier for order delivery
**Parameters**:
- `orderId: string` - ID of order to book courier for
- `payload: CourierBookingPayload` - Courier booking details including service type and address
**Returns**: `Promise<CourierBookingResult>` - Booking result with tracking info
**Throws**: `Error` - When courier booking fails
**Example**:
```typescript
import { bookCourier } from '@/api/domains/order';

const booking = await bookCourier('order123', { 
  service: 'express', 
  address: '123 Main St' 
});
console.log('Tracking:', booking.trackingNumber);
```

### `getDeliverySettings()`
**Purpose**: Get delivery settings configuration
**Parameters**: None
**Returns**: `Promise<DeliverySettings>` - Delivery settings object
**Throws**: `Error` - When delivery settings cannot be retrieved
**Example**:
```typescript
import { getDeliverySettings } from '@/api/domains/order';

const settings = await getDeliverySettings();
console.log('Default provider:', settings.defaultProvider);
```

### `connectDeliveryProvider(payload)`
**Purpose**: Connect delivery provider service
**Parameters**:
- `payload: ConnectDeliveryProviderRequest` - Provider connection details including credentials and settings
**Returns**: `Promise<void>` - Resolves when connection completes
**Throws**: `Error` - When provider connection fails
**Example**:
```typescript
import { connectDeliveryProvider } from '@/api/domains/order';

await connectDeliveryProvider({ 
  provider: 'fedex', 
  apiKey: 'key123' 
});
console.log('Provider connected');
```

### `disconnectDeliveryProvider(provider)`
**Purpose**: Disconnect delivery provider service
**Parameters**:
- `provider: DeliveryProvider` - Provider type to disconnect
**Returns**: `Promise<void>` - Resolves when disconnection completes
**Throws**: `Error` - When provider disconnection fails
**Example**:
```typescript
import { disconnectDeliveryProvider } from '@/api/domains/order';

await disconnectDeliveryProvider('fedex');
console.log('Provider disconnected');
```

### `toggleDeliveryProvider(provider, isActive)`
**Purpose**: Toggle delivery provider active status
**Parameters**:
- `provider: DeliveryProvider` - Provider type to toggle
- `isActive: boolean` - Whether provider should be active
**Returns**: `Promise<void>` - Resolves when toggle completes
**Throws**: `Error` - When provider toggle fails
**Example**:
```typescript
import { toggleDeliveryProvider } from '@/api/domains/order';

await toggleDeliveryProvider('fedex', true);
console.log('Provider is now active');
```

### `updateDeliverySettings(settings)`
**Purpose**: Update delivery settings configuration
**Parameters**:
- `settings: object` - Delivery settings including charges, COD options, and pricing
**Returns**: `Promise<void>` - Resolves when settings are updated
**Throws**: `Error` - When delivery settings update fails
**Example**:
```typescript
import { updateDeliverySettings } from '@/api/domains/order';

await updateDeliverySettings({ 
  default_delivery_charge: 10, 
  cod_enabled: true 
});
console.log('Settings updated');
```

## Customer Functions

### `getCustomers(filters?)`
**Purpose**: Get all customers with optional filtering and pagination
**Parameters**:
- `filters?: CustomerFilters` - Optional filters for searching customers by name, email, status, etc.
**Returns**: `Promise<PaginatedResponse<Customer>>` - Paginated customer list
**Throws**: `Error` - When customer retrieval fails
**Example**:
```typescript
import { getCustomers } from '@/api/domains/customer';

const customers = await getCustomers({ 
  status: 'active', 
  page: 1, 
  limit: 20 
});
console.log('Customers found:', customers.data.length);
```

### `getCustomer(customerId)`
**Purpose**: Get single customer by ID
**Parameters**:
- `customerId: string` - Unique identifier of customer to retrieve
**Returns**: `Promise<Customer>` - Customer object
**Throws**: `Error` - When customer not found or retrieval fails
**Example**:
```typescript
import { getCustomer } from '@/api/domains/customer';

const customer = await getCustomer('cust123');
console.log('Customer name:', customer.name);
```

### `createCustomer(customer)`
**Purpose**: Create new customer
**Parameters**:
- `customer: Omit<Customer, 'id' | 'shop_id' | 'created_at' | 'updated_at'>` - Customer data without auto-generated fields
**Returns**: `Promise<Customer>` - Created customer object
**Throws**: `Error` - When customer creation fails due to validation or network issues
**Example**:
```typescript
import { createCustomer } from '@/api/domains/customer';

const newCustomer = await createCustomer({ 
  name: 'John Doe', 
  email: 'john@example.com',
  phone: '+1234567890'
});
console.log('Customer created:', newCustomer.id);
```

### `updateCustomer(customerId, customer)`
**Purpose**: Update existing customer
**Parameters**:
- `customerId: string` - ID of customer to update
- `customer: Partial<Customer>` - Partial customer data with fields to update
**Returns**: `Promise<Customer>` - Updated customer object
**Throws**: `Error` - When customer update fails due to invalid ID or permissions
**Example**:
```typescript
import { updateCustomer } from '@/api/domains/customer';

const updated = await updateCustomer('cust123', { 
  name: 'Jane Doe' 
});
console.log('Customer updated:', updated.name);
```

### `blacklistCustomer(customerId, reason?)`
**Purpose**: Blacklist customer with optional reason
**Parameters**:
- `customerId: string` - ID of customer to blacklist
- `reason?: string` - Optional reason for blacklisting
**Returns**: `Promise<void>` - Resolves when blacklisting completes
**Throws**: `Error` - When customer blacklisting fails
**Example**:
```typescript
import { blacklistCustomer } from '@/api/domains/customer';

await blacklistCustomer('cust123', 'Fraudulent activity');
console.log('Customer blacklisted');
```

### `removeFromBlacklist(customerId)`
**Purpose**: Remove customer from blacklist
**Parameters**:
- `customerId: string` - ID of customer to remove from blacklist
**Returns**: `Promise<void>` - Resolves when removal completes
**Throws**: `Error` - When customer removal from blacklist fails
**Example**:
```typescript
import { removeFromBlacklist } from '@/api/domains/customer';

await removeFromBlacklist('cust123');
console.log('Customer removed from blacklist');
```

## Channel Functions

### `getChannels()`
**Purpose**: Get all communication channels
**Parameters**: None
**Returns**: `Promise<Channel[]>` - Array of channels
**Throws**: `Error` - When channel retrieval fails
**Example**:
```typescript
import { getChannels } from '@/api/domains/channel';

const channels = await getChannels();
console.log('Available channels:', channels.length);
```

### `getChannel(channelId)`
**Purpose**: Get single channel by ID
**Parameters**:
- `channelId: string` - Unique identifier of channel to retrieve
**Returns**: `Promise<Channel>` - Channel object
**Throws**: `Error` - When channel not found or retrieval fails
**Example**:
```typescript
import { getChannel } from '@/api/domains/channel';

const channel = await getChannel('channel123');
console.log('Channel name:', channel.name);
```

### `createChannel(channel)`
**Purpose**: Create new communication channel
**Parameters**:
- `channel: Omit<Channel, 'id' | 'created_at' | 'updated_at'>` - Channel data without auto-generated fields
**Returns**: `Promise<Channel>` - Created channel object
**Throws**: `Error` - When channel creation fails due to validation or network issues
**Example**:
```typescript
import { createChannel } from '@/api/domains/channel';

const newChannel = await createChannel({ 
  name: 'WhatsApp', 
  type: 'messaging',
  config: { phone: '+1234567890' }
});
console.log('Channel created:', newChannel.id);
```

### `updateChannel(channelId, updates)`
**Purpose**: Update existing channel
**Parameters**:
- `channelId: string` - ID of channel to update
- `updates: Partial<Channel>` - Partial channel data with fields to update
**Returns**: `Promise<Channel>` - Updated channel object
**Throws**: `Error` - When channel update fails due to invalid ID or permissions
**Example**:
```typescript
import { updateChannel } from '@/api/domains/channel';

const updated = await updateChannel('channel123', { 
  name: 'Updated Name' 
});
console.log('Channel updated:', updated.name);
```

### `deleteChannel(channelId)`
**Purpose**: Delete channel by ID
**Parameters**:
- `channelId: string` - ID of channel to delete
**Returns**: `Promise<{ message: string }>` - Deletion message
**Throws**: `Error` - When channel deletion fails due to invalid ID or permissions
**Example**:
```typescript
import { deleteChannel } from '@/api/domains/channel';

const result = await deleteChannel('channel123');
console.log(result.message);
```

### `initiateOAuth(channelType)`
**Purpose**: Initiate OAuth flow for channel connection
**Parameters**:
- `channelType: 'facebook' | 'instagram'` - Type of channel to connect
**Returns**: `Promise<{ redirectUrl: string; state: string }>` - OAuth redirect URL and state token
**Throws**: `Error` - When OAuth initiation fails
**Example**:
```typescript
import { initiateOAuth } from '@/api/domains/channel';

const oauth = await initiateOAuth('facebook');
window.location.href = oauth.redirectUrl;
```

### `handleOAuthCallback(code, state, channelType)`
**Purpose**: Handle OAuth callback after user authorization
**Parameters**:
- `code: string` - OAuth authorization code from callback
- `state: string` - OAuth state token from callback
- `channelType: 'facebook' | 'instagram'` - Type of channel being connected
**Returns**: `Promise<OAuthCallbackResult>` - OAuth connection result
**Throws**: `Error` - When OAuth callback handling fails
**Example**:
```typescript
import { handleOAuthCallback } from '@/api/domains/channel';

const result = await handleOAuthCallback('abc123', 'state456', 'facebook');
console.log('Connected:', result.success);
```

### `connectOAuthPage(pageId, pageName, tempToken, channelType)`
**Purpose**: Connect OAuth page to channel
**Parameters**:
- `pageId: string` - Facebook/Instagram page ID
- `pageName: string` - Display name for page
- `tempToken: string` - Temporary OAuth token
- `channelType: 'facebook' | 'instagram'` - Type of channel being connected
**Returns**: `Promise<Channel>` - Connected channel object
**Throws**: `Error` - When page connection fails
**Example**:
```typescript
import { connectOAuthPage } from '@/api/domains/channel';

const channel = await connectOAuthPage('page123', 'My Business', 'token456', 'facebook');
console.log('Connected:', channel.name);
```

### `disconnectChannel(channelId)`
**Purpose**: Disconnect channel
**Parameters**:
- `channelId: string` - ID of channel to disconnect
**Returns**: `Promise<Channel>` - Disconnected channel object
**Throws**: `Error` - When channel disconnection fails
**Example**:
```typescript
import { disconnectChannel } from '@/api/domains/channel';

const channel = await disconnectChannel('channel123');
console.log('Disconnected:', channel.name);
```

### `testChannelPipeline(channelId)`
**Purpose**: Test channel pipeline functionality
**Parameters**:
- `channelId: string` - ID of channel to test
**Returns**: `Promise<PipelineTestResult>` - Pipeline test results
**Throws**: `Error` - When pipeline test fails
**Example**:
```typescript
import { testChannelPipeline } from '@/api/domains/channel';

const test = await testChannelPipeline('channel123');
console.log('Test passed:', test.success);
```

### `subscribeChannelWebhooks(channelId)`
**Purpose**: Subscribe to channel webhooks for real-time updates
**Parameters**:
- `channelId: string` - ID of channel to subscribe webhooks for
**Returns**: `Promise<WebhookSubscriptionResult>` - Webhook subscription result
**Throws**: `Error` - When webhook subscription fails
**Example**:
```typescript
import { subscribeChannelWebhooks } from '@/api/domains/channel';

const subscription = await subscribeChannelWebhooks('channel123');
console.log('Subscribed:', subscription.success);
```

## Dashboard Functions

### `getDashboardMetrics(period?)`
**Purpose**: Get dashboard metrics for specified period
**Parameters**:
- `period?: number` - Time period in days for metrics (default: 30)
**Returns**: `Promise<DashboardMetrics>` - Dashboard metrics object
**Throws**: `Error` - When metrics retrieval fails
**Example**:
```typescript
import { getDashboardMetrics } from '@/api/domains/dashboard';

const metrics = await getDashboardMetrics(7); // Last 7 days
console.log('Total messages:', metrics.totalMessages);
```

### `getDashboardQueue()`
**Purpose**: Get dashboard queue information
**Parameters**: None
**Returns**: `Promise<DashboardQueue>` - Dashboard queue object
**Throws**: `Error` - When queue retrieval fails
**Example**:
```typescript
import { getDashboardQueue } from '@/api/domains/dashboard';

const queue = await getDashboardQueue();
console.log('Queue length:', queue.length);
```

### `getKnowledgeGaps(limit?)`
**Purpose**: Get knowledge gaps analysis
**Parameters**:
- `limit?: number` - Maximum number of gaps to return (default: 20)
**Returns**: `Promise<KnowledgeGap[]>` - Array of knowledge gaps
**Throws**: `Error` - When knowledge gaps retrieval fails
**Example**:
```typescript
import { getKnowledgeGaps } from '@/api/domains/dashboard';

const gaps = await getKnowledgeGaps(10);
console.log('Knowledge gaps:', gaps.length);
```

### `getAnalytics(period?)`
**Purpose**: Get analytics data for specified period
**Parameters**:
- `period?: number` - Time period in days for analytics (default: 30)
**Returns**: `Promise<object>` - Analytics object with messages, calls, cache hits, keyword matches, and cost estimate
**Throws**: `Error` - When analytics retrieval fails
**Example**:
```typescript
import { getAnalytics } from '@/api/domains/dashboard';

const analytics = await getAnalytics(7); // Last 7 days
console.log('Total messages:', analytics.total_messages);
```

## Knowledge Functions

### `getKnowledgeSummary()`
**Purpose**: Get knowledge base summary including FAQs
**Parameters**: None
**Returns**: `Promise<KnowledgeSummary>` - Knowledge summary object
**Throws**: `Error` - When knowledge summary retrieval fails
**Example**:
```typescript
import { getKnowledgeSummary } from '@/api/domains/knowledge';

const summary = await getKnowledgeSummary();
console.log('FAQs:', summary.faqs.length);
```

### `updateBusinessInfo(businessInfo)`
**Purpose**: Update business information for knowledge base
**Parameters**:
- `businessInfo: BusinessInfo` - Business information to update
**Returns**: `Promise<KnowledgeSummary>` - Updated knowledge summary
**Throws**: `Error` - When business info update fails
**Example**:
```typescript
import { updateBusinessInfo } from '@/api/domains/knowledge';

const updated = await updateBusinessInfo({ 
  name: 'My Business', 
  description: 'We sell products' 
});
console.log('Business info updated:', updated.businessInfo.name);
```

### `updateBrandingRules(brandingRules)`
**Purpose**: Update branding rules for knowledge base
**Parameters**:
- `brandingRules: BrandingRules` - Branding configuration rules and guidelines
**Returns**: `Promise<KnowledgeSummary>` - Updated knowledge summary
**Throws**: `Error` - When branding rules update fails
**Example**:
```typescript
import { updateBrandingRules } from '@/api/domains/knowledge';

const updated = await updateBrandingRules({ 
  tone: 'professional', 
  prohibitedWords: ['spam', 'scam'] 
});
console.log('Branding rules updated');
```

### `listFaqs()`
**Purpose**: Get all frequently asked questions
**Parameters**: None
**Returns**: `Promise<FAQ[]>` - Array of FAQs
**Throws**: `Error` - When FAQ retrieval fails
**Example**:
```typescript
import { listFaqs } from '@/api/domains/knowledge';

const faqs = await listFaqs();
console.log('Total FAQs:', faqs.length);
```

### `createFaq(faq)`
**Purpose**: Create new frequently asked question
**Parameters**:
- `faq: Omit<FAQ, 'id' | 'createdAt' | 'updatedAt'>` - FAQ data without id, createdAt, and updatedAt
**Returns**: `Promise<FAQ>` - Created FAQ object
**Throws**: `Error` - When FAQ creation fails due to validation or network issues
**Example**:
```typescript
import { createFaq } from '@/api/domains/knowledge';

const newFaq = await createFaq({ 
  question: 'What are your hours?', 
  answer: 'We are open 9-5 PM weekdays' 
});
console.log('FAQ created:', newFaq.id);
```

### `updateFaq(faqId, updates)`
**Purpose**: Update existing FAQ
**Parameters**:
- `faqId: string` - ID of FAQ to update
- `updates: Partial<FAQ>` - Partial FAQ data with fields to update
**Returns**: `Promise<FAQ>` - Updated FAQ object
**Throws**: `Error` - When FAQ update fails due to invalid ID or permissions
**Example**:
```typescript
import { updateFaq } from '@/api/domains/knowledge';

const updated = await updateFaq('faq123', { 
  answer: 'Updated answer' 
});
console.log('FAQ updated:', updated.answer);
```

### `deleteFaq(faqId)`
**Purpose**: Delete FAQ by ID
**Parameters**:
- `faqId: string` - ID of FAQ to delete
**Returns**: `Promise<{ message: string }>` - Deletion message
**Throws**: `Error` - When FAQ deletion fails due to invalid ID or permissions
**Example**:
```typescript
import { deleteFaq } from '@/api/domains/knowledge';

const result = await deleteFaq('faq123');
console.log(result.message);
```

### `listKnowledgeGaps()`
**Purpose**: Get knowledge gaps analysis
**Parameters**: None
**Returns**: `Promise<KnowledgeGap[]>` - Array of knowledge gaps
**Throws**: `Error` - When knowledge gaps retrieval fails
**Example**:
```typescript
import { listKnowledgeGaps } from '@/api/domains/knowledge';

const gaps = await listKnowledgeGaps();
console.log('Knowledge gaps:', gaps.length);
```

### `listDocuments()`
**Purpose**: Get all knowledge documents
**Parameters**: None
**Returns**: `Promise<KnowledgeDocument[]>` - Array of knowledge documents
**Throws**: `Error` - When document retrieval fails
**Example**:
```typescript
import { listDocuments } from '@/api/domains/knowledge';

const documents = await listDocuments();
console.log('Documents:', documents.length);
```

### `createDocument(document)`
**Purpose**: Create new knowledge document
**Parameters**:
- `document: object` - Document data including name, content type, size, URL, text, tags, and source
**Returns**: `Promise<KnowledgeDocument>` - Created document object
**Throws**: `Error` - When document creation fails due to validation or network issues
**Example**:
```typescript
import { createDocument } from '@/api/domains/knowledge';

const newDoc = await createDocument({ 
  name: 'Product Guide', 
  text: 'How to use our products...', 
  contentType: 'text/markdown',
  tags: ['products', 'guide'] 
});
console.log('Document created:', newDoc.id);
```

## Campaign Functions

### `getCampaigns()`
**Purpose**: Get all marketing campaigns
**Parameters**: None
**Returns**: `Promise<Campaign[]>` - Array of campaigns
**Throws**: `Error` - When campaign retrieval fails
**Example**:
```typescript
import { getCampaigns } from '@/api/domains/campaign';

const campaigns = await getCampaigns();
console.log('Active campaigns:', campaigns.length);
```

### `getCampaign(campaignId)`
**Purpose**: Get single campaign by ID
**Parameters**:
- `campaignId: string` - Unique identifier of campaign to retrieve
**Returns**: `Promise<Campaign>` - Campaign object
**Throws**: `Error` - When campaign not found or retrieval fails
**Example**:
```typescript
import { getCampaign } from '@/api/domains/campaign';

const campaign = await getCampaign('campaign123');
console.log('Campaign name:', campaign.name);
```

### `createCampaign(request)`
**Purpose**: Create new marketing campaign
**Parameters**:
- `request: CreateCampaignRequest` - Campaign data including name, type, content, and scheduling
**Returns**: `Promise<Campaign>` - Created campaign object
**Throws**: `Error` - When campaign creation fails due to validation or network issues
**Example**:
```typescript
import { createCampaign } from '@/api/domains/campaign';

const newCampaign = await createCampaign({ 
  name: 'Summer Sale', 
  type: 'email', 
  content: 'Get 20% off...' 
});
console.log('Campaign created:', newCampaign.id);
```

### `updateCampaign(campaignId, updates)`
**Purpose**: Update existing campaign
**Parameters**:
- `campaignId: string` - ID of campaign to update
- `updates: Partial<Campaign>` - Partial campaign data with fields to update
**Returns**: `Promise<Campaign>` - Updated campaign object
**Throws**: `Error` - When campaign update fails due to invalid ID or permissions
**Example**:
```typescript
import { updateCampaign } from '@/api/domains/campaign';

const updated = await updateCampaign('campaign123', { 
  name: 'Updated Name' 
});
console.log('Campaign updated:', updated.name);
```

### `deleteCampaign(campaignId)`
**Purpose**: Delete existing campaign
**Parameters**:
- `campaignId: string` - ID of campaign to delete
**Returns**: `Promise<void>` - Resolves to void
**Throws**: `Error` - When campaign deletion fails
**Example**:
```typescript
import { deleteCampaign } from '@/api/domains/campaign';

await deleteCampaign('campaign123');
console.log('Campaign deleted');
```

### `scheduleCampaign(campaignId, scheduledTime)`
**Purpose**: Schedule campaign for future delivery
**Parameters**:
- `campaignId: string` - ID of campaign to schedule
- `scheduledTime: string` - ISO datetime string when campaign should be sent
**Returns**: `Promise<Campaign>` - Scheduled campaign object
**Throws**: `Error` - When campaign scheduling fails
**Example**:
```typescript
import { scheduleCampaign } from '@/api/domains/campaign';

const scheduled = await scheduleCampaign('campaign123', '2024-07-15T10:00:00Z');
console.log('Scheduled for:', scheduled.scheduledTime);
```

### `launchCampaign(campaignId)`
**Purpose**: Launch campaign immediately
**Parameters**:
- `campaignId: string` - ID of campaign to launch
**Returns**: `Promise<Campaign>` - Launched campaign object
**Throws**: `Error` - When campaign launch fails
**Example**:
```typescript
import { launchCampaign } from '@/api/domains/campaign';

const launched = await launchCampaign('campaign123');
console.log('Campaign status:', launched.status);
```

### `getCampaignStats(campaignId)`
**Purpose**: Get campaign performance statistics
**Parameters**:
- `campaignId: string` - ID of campaign to get stats for
**Returns**: `Promise<CampaignStats>` - Campaign statistics object
**Throws**: `Error` - When campaign stats retrieval fails
**Example**:
```typescript
import { getCampaignStats } from '@/api/domains/campaign';

const stats = await getCampaignStats('campaign123');
console.log('Open rate:', stats.openRate);
```

## Subscription Functions

### `getSubscription()`
**Purpose**: Get current subscription details
**Parameters**: None
**Returns**: `Promise<Subscription>` - Subscription object
**Throws**: `Error` - When subscription retrieval fails
**Example**:
```typescript
import { getSubscription } from '@/api/domains/subscription';

const subscription = await getSubscription();
console.log('Plan:', subscription.plan.name);
```

### `getSubscriptionPlans()`
**Purpose**: Get available subscription plans
**Parameters**: None
**Returns**: `Promise<SubscriptionPlan[]>` - Array of subscription plans
**Throws**: `Error` - When plan retrieval fails
**Example**:
```typescript
import { getSubscriptionPlans } from '@/api/domains/subscription';

const plans = await getSubscriptionPlans();
console.log('Available plans:', plans.length);
```

### `subscribeToPlan(planId, billingCycle?)`
**Purpose**: Subscribe to a plan
**Parameters**:
- `planId: string` - ID of plan to subscribe to
- `billingCycle?: 'monthly' | 'yearly'` - Billing cycle (default: 'monthly')
**Returns**: `Promise<Subscription>` - Subscription object
**Throws**: `Error` - When subscription fails
**Example**:
```typescript
import { subscribeToPlan } from '@/api/domains/subscription';

const subscription = await subscribeToPlan('plan123', 'yearly');
console.log('Subscribed to yearly plan');
```

### `cancelSubscription(reason?)`
**Purpose**: Cancel current subscription
**Parameters**:
- `reason?: string` - Optional reason for cancellation
**Returns**: `Promise<Subscription>` - Updated subscription object
**Throws**: `Error` - When cancellation fails
**Example**:
```typescript
import { cancelSubscription } from '@/api/domains/subscription';

const cancelled = await cancelSubscription('Too expensive');
console.log('Status:', cancelled.status);
```

### `reactivateSubscription()`
**Purpose**: Reactivate cancelled subscription
**Parameters**: None
**Returns**: `Promise<Subscription>` - Reactivated subscription object
**Throws**: `Error` - When reactivation fails
**Example**:
```typescript
import { reactivateSubscription } from '@/api/domains/subscription';

const reactivated = await reactivateSubscription();
console.log('Status:', reactivated.status);
```

### `getPaymentMethods()`
**Purpose**: Get available payment methods
**Parameters**: None
**Returns**: `Promise<PaymentMethod[]>` - Array of payment methods
**Throws**: `Error` - When payment methods retrieval fails
**Example**:
```typescript
import { getPaymentMethods } from '@/api/domains/subscription';

const methods = await getPaymentMethods();
console.log('Available methods:', methods.length);
```

### `addPaymentMethod(paymentMethodId)`
**Purpose**: Add new payment method
**Parameters**:
- `paymentMethodId: string` - ID of payment method to add
**Returns**: `Promise<PaymentMethod>` - Added payment method object
**Throws**: `Error` - When payment method addition fails
**Example**:
```typescript
import { addPaymentMethod } from '@/api/domains/subscription';

const method = await addPaymentMethod('payment123');
console.log('Added:', method.type);
```

### `removePaymentMethod(paymentMethodId)`
**Purpose**: Remove payment method
**Parameters**:
- `paymentMethodId: string` - ID of payment method to remove
**Returns**: `Promise<void>` - Resolves when removal completes
**Throws**: `Error` - When payment method removal fails
**Example**:
```typescript
import { removePaymentMethod } from '@/api/domains/subscription';

await removePaymentMethod('payment123');
console.log('Payment method removed');
```

### `setDefaultPaymentMethod(paymentMethodId)`
**Purpose**: Set default payment method
**Parameters**:
- `paymentMethodId: string` - ID of payment method to set as default
**Returns**: `Promise<void>` - Resolves when default is set
**Throws**: `Error` - When setting default payment method fails
**Example**:
```typescript
import { setDefaultPaymentMethod } from '@/api/domains/subscription';

await setDefaultPaymentMethod('payment123');
console.log('Payment method set as default');
```

### `getInvoices()`
**Purpose**: Get invoice history
**Parameters**: None
**Returns**: `Promise<Invoice[]>` - Array of invoices
**Throws**: `Error` - When invoice retrieval fails
**Example**:
```typescript
import { getInvoices } from '@/api/domains/subscription';

const invoices = await getInvoices();
console.log('Total invoices:', invoices.length);
```

### `getInvoice(invoiceId)`
**Purpose**: Get single invoice by ID
**Parameters**:
- `invoiceId: string` - Unique identifier of invoice to retrieve
**Returns**: `Promise<Invoice>` - Invoice object
**Throws**: `Error` - When invoice not found or retrieval fails
**Example**:
```typescript
import { getInvoice } from '@/api/domains/subscription';

const invoice = await getInvoice('invoice123');
console.log('Amount:', invoice.amount);
```

## Error Handling

All API functions follow consistent error handling patterns:

### Common Error Types
- **Network errors**: Connection timeouts, server unavailability
- **Authentication errors**: Invalid tokens, expired sessions
- **Validation errors**: Invalid input data, missing required fields
- **Permission errors**: Unauthorized access, insufficient privileges
- **Not found errors**: Resource doesn't exist
- **Server errors**: Internal server errors, database issues

### Error Response Format
```typescript
interface ApiError {
  message: string;     // Human-readable error description
  code?: string;        // Error code for programmatic handling
  details?: any;       // Additional error context
  statusCode?: number;   // HTTP status code
}
```

### Best Practices
1. **Always use try-catch blocks** when calling API functions
2. **Check for specific error types** to provide better user feedback
3. **Implement retry logic** for transient network errors
4. **Log errors appropriately** for debugging and monitoring
5. **Provide meaningful error messages** to end users

## Type Definitions

### Common Types
```typescript
interface ApiResponse<T> {
  data: T;
  message?: string;
  success?: boolean;
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
```

### Domain-Specific Types
Each domain has its own type definitions in `src/api/types/`:
- `auth.ts` - Authentication and user types
- `product.ts` - Product and category types
- `order.ts` - Order and delivery types
- `customer.ts` - Customer and filtering types
- `channel.ts` - Channel and integration types
- `dashboard.ts` - Analytics and metrics types
- `knowledge.ts` - Knowledge base and FAQ types
- `campaign.ts` - Campaign and marketing types
- `subscription.ts` - Billing and subscription types

## Usage Guidelines

### Import Patterns
```typescript
// Import specific functions
import { signin, signup } from '@/api/domains/auth';
import { getProducts, createProduct } from '@/api/domains/product';
import { getOrders, createOrder } from '@/api/domains/order';

// Import entire domain
import * as authAPI from '@/api/domains/auth';
import * as productAPI from '@/api/domains/product';
```

### Async/Await Usage
All API functions return Promises and should be used with async/await:
```typescript
// Correct
const user = await signin(credentials);
const products = await getProducts();

// Incorrect (will cause Promise handling issues)
const user = signin(credentials);
const products = getProducts();
```

### Error Handling
```typescript
try {
  const result = await apiFunction(params);
  // Handle success
} catch (error) {
  console.error('API Error:', error.message);
  // Handle error appropriately
  throw error; // Re-throw if needed
}
```

### TypeScript Integration
```typescript
// Leverage type safety
const products: Product[] = await getProducts({ category: 'electronics' });
const customer: Customer = await getCustomer('cust123');

// Type checking will catch issues at compile time
const invalid = await getProducts(123); // TypeScript error
```
