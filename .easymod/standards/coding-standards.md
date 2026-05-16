# EasyModerator Coding Standards

## Backend (Node.js + Express)

### File Naming
```
{name}.controller.js    ← HTTP layer only, no business logic
{name}.service.js       ← all business logic lives here
{name}.entity.js        ← Sequelize model definition
{name}.routes.js        ← Express router
{name}.validator.js     ← Joi/Zod request validation schemas
{name}.types.js         ← JSDoc/TS type definitions (optional)
__tests__/              ← test files (co-located with module)
```

### Service Layer Rules
- ALL business logic in `{module}.service.js` — controllers are HTTP adapters only
- Controllers call services, never call other controllers
- Services may call services from other modules (allowed cross-module imports)
- Never perform DB operations in controllers, routes, or middleware (except auth middleware reading user)
- Singleton pattern: `module.exports = new ServiceClass()` — services are singletons

### Error Propagation
```js
// Throw AppError from services — caught and formatted by error middleware
const AppError = require('../../shared/errors/AppError')

throw new AppError('Customer not found', 404)
throw new AppError('Conversation limit reached', 429)
throw new AppError('BKash payment configuration missing', 400)
throw new AppError('Invalid webhook signature', 401)
```

### Logging
```js
const { createLogger } = require('../../shared/logger')
const logger = createLogger('OrderService')

// Structured: always include shopId and relevant entity IDs
logger.info('Order created', { orderId: order.id, shopId, total: order.total_amount })
logger.warn('Rate limit approaching', { pageId, currentRate: 160, limit: 170 })
logger.error('BKash token refresh failed', { shopId, error: err.message })

// NEVER log: passwords, access_tokens, channel tokens, PSIDs, full phone numbers, card data
```

### Sequelize Rules
```js
// Primary key: UUID always
id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true }

// Tenant scoping: non-negotiable
shop_id: { type: DataTypes.UUID, allowNull: false }

// Soft deletes: on all business entities (Order, Customer, Product, etc.)
{ paranoid: true }

// Timestamps: always enabled (createdAt, updatedAt)
{ timestamps: true }

// Always include shop_id in every tenant query:
const order = await Order.findOne({ where: { id, shop_id: shop.id } })
```

### Environment Variables
- All external service credentials via `process.env` — never hardcoded
- Validate required vars at startup (fail fast before server starts)
- Naming convention: `SERVICE_RESOURCE_PURPOSE`
  ```
  BKASH_APP_KEY, BKASH_APP_SECRET, BKASH_WEBHOOK_SECRET
  GEMINI_API_KEY, OPENAI_API_KEY
  META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN
  CHANNEL_ENCRYPTION_KEY, JWT_SECRET
  ```

### BullMQ Job Conventions
```js
// Queue names: kebab-case
'message-processing', 'invoice-generation', 'auto-index', 'email-queue'

// Job options: always include attempts, backoff, removeOnComplete, group.id
{
  group: { id: shopId },                // fair-queueing per shop
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: 100,
  removeOnFail: 200
}

// Job names: verb-noun
'process-message', 'generate-invoice', 'index-knowledge', 'send-notification'
```

### BD-Specific Conventions
```js
// Phone: store normalized as 01XXXXXXXXX (10 digits)
const normalizePhone = (raw) => raw.replace(/^(\+?880|0{1,2})/, '01').replace(/\D/g, '')
// Input: '+8801712345678' → '01712345678'

// Currency: store as DECIMAL(10,2) in BDT
// Display with ৳ prefix: '৳750.00'

// Dates: store UTC in PostgreSQL
// Display in Asia/Dhaka timezone for seller-facing output

// Language: always detect before AI reply — use language-switcher.service.js
const { language } = languageSwitcher.detect(messageText)
// language: 'bn' | 'banglish' | 'en'

// Order numbers: ORD-XXXXXX-XXXXXX format (auto-generated)
```

---

## Frontend (React 18 + TypeScript)

### File Naming
```
{ComponentName}.tsx      ← React components (PascalCase)
use{HookName}.ts         ← custom hooks (camelCase with 'use' prefix)
{feature}.api.ts         ← TanStack Query hooks + fetch functions
{feature}.types.ts       ← TypeScript types
{feature}.utils.ts       ← pure utility functions
```

### Component Architecture Rules
- Feature-domain components → `src/features/{feature}/components/`
- Shared cross-cutting components → `src/shared/components/`
- Layout / page shell components → `src/app/components/`
- NEVER fetch API data in page components — use TanStack Query hooks
- All route components must be lazy-loaded: `React.lazy(() => import('./Page'))`
- Always wrap lazy components: `withSuspense(LazyComponent)`

### TypeScript Rules
```ts
// No 'any' without a justification comment
const data: any // eslint-disable-next-line — third-party SDK returns untyped shape

// All API response types defined
interface OrderListResponse {
  data: Order[]
  meta: { total: number; page: number; limit: number }
}

// Props always typed with interface
interface OrderCardProps {
  order: Order
  onDispatch: (orderId: string) => void
}

// Never use React.FC — function declaration preferred
function OrderCard({ order, onDispatch }: OrderCardProps) { ... }
```

### TanStack Query Rules
```ts
// Query keys: factory pattern
export const orderKeys = {
  all: ['orders'] as const,
  lists: () => [...orderKeys.all, 'list'] as const,
  list: (f: Filters) => [...orderKeys.lists(), f] as const,
  detail: (id: string) => [...orderKeys.all, id] as const,
}

// Mutations: always invalidate on success
onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKeys.lists() })
```

### Accessibility (BD seller UX)
- All form inputs: associated `<label>` element (required for BD phone input)
- All icon-only buttons: `aria-label` attribute
- Loading states: `<Skeleton />` components — never blank screen
- BD phone input: `pattern="01[3-9][0-9]{8}"` + hint text "01XXXXXXXXX"
- Minimum touch target: 44×44px (mobile-first for BD sellers)

### Tailwind + Radix Patterns
```tsx
import { cn } from '@/app/lib/utils'

// Conditional classes with cn():
<div className={cn('base-classes', condition && 'conditional-class')} />

// Always use Radix UI primitives for interactive elements
// Dialog, DropdownMenu, Select, Checkbox, Switch — never roll custom
```

---

## Comments Policy

Write a comment ONLY when:
- The code does something non-obvious (a workaround for a specific bug)
- There's a constraint that isn't apparent from the code (Meta rate limit reason)
- Behavior would surprise a future reader

Never write:
- Comments explaining WHAT the code does (the code does that)
- Comments referencing the ticket/PR ("Added for issue #123")
- Multi-line comment blocks for simple logic
