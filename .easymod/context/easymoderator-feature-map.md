# EasyModerator Feature Map

## Backend Module Map (`EasyMod-backend/src/modules/`)

| Module | Key Services | Key Entities | Notes |
|--------|-------------|-------------|-------|
| `admin` | admin.service.js | — | Admin-only operations, user management |
| `ai` | intent-router.service.js, llm.service.js, guardrail.service.js, meta-send.service.js, sentiment.service.js, hallucination-detector.service.js, circuit-breaker.service.js, language-switcher.service.js, auto-approve.service.js, image-product-matcher.service.js, voice-processing.service.js, llm-tier-selection.service.js, gemini-cache.service.js | — | Core AI pipeline |
| `analytics` | analytics.service.js | — | Usage analytics per shop |
| `audit` | audit.service.js | AuditLog | Immutable audit trail |
| `auth` | auth.service.js, totp.service.js | — | JWT auth, signup/signin, 2FA |
| `category` | category.service.js | Category | Product categories |
| `channel` | channel.service.js, channel.oauth.service.js | Channel | FB/IG/WhatsApp/Telegram connections; tokens encrypted at rest |
| `conversation` | conversation.service.js | Conversation | Unified inbox; hitl_active flag; ai_pause tracking |
| `customer` | customer.service.js | Customer | Customer profiles; messenger_opted_out; whatsapp_opted_out; RTO tracking |
| `dashboard` | dashboard.service.js | — | Dashboard stats aggregation |
| `delivery` | delivery.service.js, order-tracking.service.js, delivery-rag.service.js | DeliveryZone | Provider registry; Pathao/Steadfast/RedX adapters |
| `entities` | — | All entities barrel | `entities.js` re-exports all Sequelize models |
| `integration` | meta.controller.js | — | Meta webhook ingestion controller |
| `invoice` | invoice.service.js | Invoice | Monthly invoice generation for PARTNER plan |
| `keyword` | keyword.service.js | Keyword | Comment trigger keywords per shop |
| `knowledge` | knowledge.service.js | Knowledge | FAQ/document knowledge base for RAG |
| `language` | language.service.js | — | i18n support (en + bn) |
| `notification` | owner-notification.service.js | Notification | SSE + push notifications to seller |
| `order` | order.service.js, order-session.service.js | Order | Order lifecycle: PENDING → DISPATCHED → DELIVERED/RETURNED |
| `payment` | payment.service.js, bkash-merchant.service.js, smart-payment-detection.service.js | PaymentConfig, Payment | BKash Merchant API, payment config per shop |
| `product` | product.service.js, product-embedding.service.js | Product | Product catalog + AI embeddings for RAG |
| `rag` | rag.service.js, embedding.service.js | — | Vector DB client (Pinecone/Qdrant), embedding generation |
| `reconciliation` | daily-overage-calculator.js, failed-payment-reconciler.js, invoice-generator.js | — | PARTNER plan daily billing; failed payment retry |
| `rto-shield` | rto-shield.service.js | RtoShieldEntry | Phone blacklist/whitelist; auto-flag on ≥3 attempts + ≥40% RTO rate |
| `shop` | shop.service.js | Shop | Central SaaS tenant entity; all other entities belong to shop |
| `subscription` | subscription.service.js | Subscription, ConversationUsage | Plan management, conversation counting, limit enforcement |
| `support` | support.service.js | — | Support tickets |
| `template` | template.service.js | Template | Message templates |
| `tenant` | tenant.service.js | — | Multi-tenant isolation utilities |
| `user` | user.service.js | User | User accounts (one user = one shop in current model) |
| `user-shop` | — | UserShop | User-shop relationship (multi-admin future) |
| `webhooks` | payment-webhook.controller.js | TrxIdLog | BKash + courier webhook handlers |

---

## AI Feature Map

| Feature | Service | Status |
|---------|---------|--------|
| Intent routing (3-tier) | `intent-router.service.js` | Active |
| LLM failover chain | `llm.service.js` + `circuit-breaker.service.js` | Active |
| Tier-based model selection | `llm-tier-selection.service.js` | Active |
| Gemini caching | `gemini-cache.service.js` | Active |
| Guardrail chain (5 guards) | `guardrail.service.js` | Active |
| Hallucination detection | `hallucination-detector.service.js` | Active |
| Prompt injection detection | `prompt-sanitizer.service.js` | Active |
| Language detection (bn/banglish/en) | `language-switcher.service.js` | Active |
| Product RAG retrieval | `rag.service.js` | Active |
| Delivery RAG | `delivery-rag.service.js` | Active |
| Knowledge auto-indexing | `auto-index.job.js` | Active |
| Image product matching | `image-product-matcher.service.js` | Active |
| Voice note processing | `voice-processing.service.js` | Active |
| BERT embeddings | `bert-client.service.js` | Active |
| Sentiment analysis | `sentiment.service.js` | Active |
| Auto-approve logic | `auto-approve.service.js` | Active |

---

## Subscription Feature Map

| Feature | Details |
|---------|---------|
| PACKAGE_1 | 750 BDT/month, 500 conversations |
| PACKAGE_2 | 1,950 BDT/month, 1,500 conversations |
| PARTNER | 0 BDT + per-delivered-order (15/12/10 BDT tiered) |
| PARTNER eligibility | 300+ confirmed orders/month |
| Conversation grace buffer | 50 conversations above limit before hard block |
| Top-up packs | 100 / 250 / 500 / 1,000 conversations |
| Limit enforcement | `subscription.service.js` → `ConversationUsage` entity |
| Billing | Monthly via BKash; PARTNER monthly calculation job |
| Failed payment handling | `failed-payment-reconciler.js` BullMQ job |

---

## Channel Feature Map

| Channel | OAuth Flow | Automation | Status |
|---------|-----------|-----------|--------|
| Facebook | `channel.oauth.service.js` → `/app/channels/oauth-callback` | Comment trigger → DM | Active |
| Instagram | Same OAuth flow | Comment trigger → IG DM | Active |
| WhatsApp | WhatsApp Business API | Explicit opt-in required | Active |
| Telegram | Telegram Bot API | Basic messaging | Active |

---

## Commerce Feature Map

| Feature | Details |
|---------|---------|
| Order lifecycle | PENDING → PROCESSING → DISPATCHED → DELIVERED / RETURNED |
| Order numbering | ORD-XXXXXX-XXXXXX (auto-generated unique) |
| Order session | `order-session.service.js` — DM checkout flow state |
| Products | Catalog with variants, stock guard, AI embeddings |
| Product embedding | `product-embedding.service.js` — auto-embed on product save |
| Customers | Profiles with BD phone normalization, conversation history, RTO tracking |
| Customer memory | Preference and order history for AI personalization |
| RTO Shield | Phone blacklist, auto-flag ≥3 delivery attempts + ≥40% RTO rate |

---

## Payment Feature Map

| Feature | Details |
|---------|---------|
| BKash Merchant API | OAuth2 token (50-min cache), create payment, execute payment |
| BKash environment | Sandbox (`BKASH_SANDBOX=true`) vs production |
| Smart payment detection | Auto-detect active payment gateway per shop |
| Payment webhooks | `POST /api/payment-webhook/bkash`, HMAC-SHA256 verified, TrxIdLog idempotency |
| Self MFS handler | Manual mobile banking transfer recording |

---

## Delivery Feature Map

| Provider | Auth | Sandbox | Status |
|---------|------|---------|--------|
| Pathao | OAuth2 (username + password) | Yes (`isSandbox` flag) | Active |
| Steadfast | API-Key + Secret-Key headers | No | Active |
| RedX | Bearer token | No | Active |
| Paperfly | Not yet implemented | — | Planned |

---

## Frontend Route Map

| Route | Component | Auth | Description |
|-------|-----------|------|-------------|
| `/` | LandingPage | No | Marketing |
| `/signin` | SignIn | No | |
| `/signup` | SignUp | No | |
| `/pricing` | Pricing | No | |
| `/privacy-policy` | PrivacyPolicy | No | Required by Meta App Review |
| `/terms` | Terms | No | Required by Meta App Review |
| `/app` | DashboardLayout | Yes | Protected shell |
| `/app/inbox` | UnifiedInbox | Yes | Real-time SSE conversations |
| `/app/channels` | Channels | Yes | Channel list |
| `/app/channels/oauth-callback` | OAuthCallback | Yes | |
| `/app/manage-shop` | ShopSettings | Yes | |
| `/app/manage-shop/business` | BusinessSettings | Yes | |
| `/app/manage-shop/ai-config` | AIConfig | Yes | |
| `/app/manage-shop/delivery` | DeliverySettings | Yes | |
| `/app/manage-shop/payment` | PaymentSettings | Yes | |
| `/app/products` | Products | Yes | |
| `/app/categories` | Categories | Yes | |
| `/app/orders` | Orders | Yes | |
| `/app/customers` | Customers | Yes | RTO flags |
| `/app/knowledge` | Knowledge | Yes | RAG knowledge base |
| `/app/reports` | Reports | Yes | |
| `/app/audit-logs` | AuditLogs | Yes | |
| `/app/subscription` | Subscription | Yes | Plan + top-up |
| `/app/admin/users` | AdminUsers | Yes | Admin only |
| `/bd-lite` | BDSellerShell | Yes | Mobile-first BD sellers |
| `/bd-lite/today-queue` | TodayQueueDashboard | Yes | |
| `/bd-lite/inbox` | BDInbox | Yes | |
| `/bd-lite/orders` | BDOrders | Yes | |
