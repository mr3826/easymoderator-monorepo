---
name: em-frontend-skill
description: "EasyModerator frontend skill. Use when building React components for /app/inbox, /app/orders, /app/channels, /app/manage-shop, /app/knowledge, /bd-lite. Covers TanStack Query, Radix UI/Tailwind, BD-first UX for f-commerce sellers."
---

# Frontend Skill — EasyModerator Senior Frontend Engineer

## ROLE
Senior Frontend Engineer for EasyModerator — React 18 + TypeScript + Vite + Tailwind + TanStack Query + Radix UI.

## STACK
React 18 | TypeScript | Vite | React Router v7 | TanStack Query v5 | Radix UI | Tailwind CSS 4 | React Hook Form + Zod | i18next (en + bn) | Sentry

---

## ROUTE INVENTORY

All routes defined in `src/app/routes.ts`:

| Route | Component | Auth | Notes |
|-------|-----------|------|-------|
| `/` | LandingPage | No | Marketing |
| `/signin` | SignIn | No | React Hook Form + Zod |
| `/signup` | SignUp | No | React Hook Form + Zod |
| `/pricing` | Pricing | No | |
| `/privacy-policy` | PrivacyPolicy | No | |
| `/terms` | Terms | No | |
| `/app` | DashboardLayout | Yes | Shell with sidebar |
| `/app/inbox` | UnifiedInbox | Yes | SSE for real-time messages |
| `/app/channels` | Channels | Yes | FB/IG/WhatsApp/Telegram |
| `/app/channels/oauth-callback` | OAuthCallback | Yes | Channel OAuth flow |
| `/app/manage-shop` | ShopSettings | Yes | |
| `/app/manage-shop/business` | BusinessSettings | Yes | |
| `/app/manage-shop/ai-config` | AIConfig | Yes | Intent router + RAG settings |
| `/app/manage-shop/delivery` | DeliverySettings | Yes | Provider config |
| `/app/manage-shop/payment` | PaymentSettings | Yes | BKash config |
| `/app/products` | Products | Yes | |
| `/app/products/create` | CreateProduct | Yes | |
| `/app/products/:id/edit` | EditProduct | Yes | |
| `/app/categories` | Categories | Yes | |
| `/app/orders` | Orders | Yes | |
| `/app/customers` | Customers | Yes | RTO Shield flags |
| `/app/knowledge` | Knowledge | Yes | RAG knowledge base |
| `/app/reports` | Reports | Yes | |
| `/app/audit-logs` | AuditLogs | Yes | |
| `/app/subscription` | Subscription | Yes | Plan + top-up packs |
| `/app/admin/users` | AdminUsers | Yes | Admin only |
| `/bd-lite` | BDSellerShell | Yes | Simplified BD seller UI |
| `/bd-lite/today-queue` | TodayQueueDashboard | Yes | |
| `/bd-lite/inbox` | BDInbox | Yes | |
| `/bd-lite/orders` | BDOrders | Yes | |

All route components are lazy-loaded via `React.lazy()` and wrapped with `withSuspense()`.

---

## COMPONENT ARCHITECTURE

```
src/
├── app/
│   ├── App.tsx                    ← root (theme, i18n, QueryClient, Sentry)
│   ├── routes.ts                  ← React Router v7 definitions
│   └── components/                ← layout/shell components
│       ├── DashboardLayout.tsx
│       ├── BDSellerShell.tsx
│       ├── Sidebar.tsx
│       └── withSuspense.tsx
├── features/                      ← domain feature modules
│   ├── auth/
│   ├── channels/
│   ├── customers/
│   ├── dashboard/
│   ├── knowledge/
│   ├── orders/
│   ├── products/
│   ├── reports/
│   ├── settings/
│   ├── shop/
│   └── subscription/
├── shared/                        ← cross-cutting
│   ├── components/
│   │   ├── guards/                ← AuthGuard, AdminGuard
│   │   └── ErrorBoundary.tsx
│   ├── context/
│   │   └── AuthContext.tsx
│   └── hooks/
│       ├── useDebounce.ts
│       └── useIntersectionObserver.ts
└── api/
    ├── index.ts                   ← apiClient singleton (axios + interceptors)
    └── domains/                   ← per-domain API functions
        ├── auth.api.ts
        ├── orders.api.ts
        ├── products.api.ts
        └── ...
```

---

## TANSTACK QUERY CONVENTIONS

### Query key factory pattern:
```ts
// src/api/domains/orders.api.ts
export const orderKeys = {
  all: ['orders'] as const,
  lists: () => [...orderKeys.all, 'list'] as const,
  list: (filters: OrderFilters) => [...orderKeys.lists(), filters] as const,
  detail: (id: string) => [...orderKeys.all, 'detail', id] as const,
}
```

### Query hook:
```ts
export const useOrders = (filters: OrderFilters) =>
  useQuery({
    queryKey: orderKeys.list(filters),
    queryFn: () => fetchOrders(filters),
    staleTime: 60_000,        // 1 minute for list data
  })

// Conversations: staleTime 0 (always fresh — real-time inbox)
export const useConversations = (shopId: string) =>
  useQuery({
    queryKey: ['conversations', shopId],
    queryFn: () => fetchConversations(shopId),
    staleTime: 0,
  })
```

### Mutation with invalidation:
```ts
export const useCreateOrder = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createOrder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderKeys.lists() })
    },
  })
}
```

### Stale time strategy:
| Data Type | staleTime |
|-----------|-----------|
| Conversations / inbox | `0` (always fresh) |
| Orders list | `60_000` (1 min) |
| Products / categories | `300_000` (5 min) |
| Shop settings | `300_000` (5 min) |
| Subscription status | `60_000` (1 min) |
| Analytics / reports | `300_000` (5 min) |

---

## RADIX UI + TAILWIND PATTERNS

### cn() utility for conditional classes:
```ts
import { cn } from '@/app/lib/utils'

<div className={cn(
  'rounded-lg border p-4',
  isActive && 'border-primary bg-primary/10',
  isError && 'border-destructive bg-destructive/10'
)} />
```

### Radix Dialog pattern:
```tsx
import * as Dialog from '@radix-ui/react-dialog'

<Dialog.Root open={open} onOpenChange={setOpen}>
  <Dialog.Trigger asChild>
    <Button>Open</Button>
  </Dialog.Trigger>
  <Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 bg-black/50 animate-in fade-in" />
    <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg p-6 w-full max-w-md">
      <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
      {children}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
```

### Form with React Hook Form + Zod:
```tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

const schema = z.object({
  phone: z.string().regex(/^01[3-9]\d{8}$/, 'Enter valid BD phone number'),
  name: z.string().min(2, 'Name required'),
})

const form = useForm({ resolver: zodResolver(schema) })
```

---

## BD-FIRST UX RULES

**Mobile-first:** BD sellers primarily manage shops on phones (Android). Always design for 375px width first.

**BDT currency formatting:**
```ts
const formatBDT = (amount: number) =>
  `৳${amount.toLocaleString('bn-BD', { minimumFractionDigits: 0 })}`
// Output: ৳১,৫০০ or ৳1,500 (use 'en-BD' for Latin digits)
```

**Phone number format:** Always display as `01XXXXXXXXX` (10 digits). Store normalized.

**Banglish support:** All user-facing text supports `en` and `bn` via i18next. Key namespaces: `common`, `orders`, `inbox`, `channels`, `settings`.

**Order status vocabulary in BD context:**
- PENDING → "অপেক্ষমান" (Opekhoman) / "Pending"
- DISPATCHED → "পাঠানো হয়েছে" / "Dispatched"
- DELIVERED → "পৌঁছেছে" / "Delivered"
- RETURNED → "ফেরত" / "Returned"

**Loading states:** Always use Skeleton components (not spinner only) for list items. Never show a blank screen.

**RTO risk display:** Orders with `rto_risk_flag = true` shown with a warning badge in `bg-yellow-100 text-yellow-800`.

---

## BD-LITE SHELL

`/bd-lite/*` routes use `BDSellerShell` layout instead of `DashboardLayout`.

Differences:
- Simplified bottom navigation (4 tabs: Today Queue, Inbox, Orders, Settings)
- Larger touch targets (48px minimum)
- Bengali/Banglish-first labeling
- No sidebar — mobile-only layout
- `TodayQueueDashboard` shows orders pending processing for the day

Use `/bd-lite/*` for low-end device / mobile-first seller experience.

---

## ALWAYS

- Lazy-load route components with `withSuspense()`
- Use TanStack Query for all server state (no useState for API data)
- Use React Hook Form + Zod for all forms
- Add `aria-label` to all icon-only buttons
- Use Radix UI primitives for interactive elements (Dialog, Dropdown, etc.)
- Wrap mutations in optimistic updates only when the optimistic state is safe to show
- Handle empty states explicitly (no blank `null` renders)

## NEVER

- Fetch data directly in page components — always use TanStack Query hooks
- Use `any` in TypeScript without a justification comment
- Add inline styles except for dynamic values impossible with Tailwind
- Put feature-specific logic in `src/shared/` — that's for cross-cutting utilities only
- Use `useEffect` to sync server state — use TanStack Query for that
