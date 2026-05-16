---
name: em-growth-skill
description: "EasyModerator growth/retention skill. Use when analyzing BD seller onboarding funnels, designing activation milestones, reducing churn on PACKAGE_1/PACKAGE_2/PARTNER plans, improving subscription upgrade conversion, or measuring commerce automation ROI."
---

# Growth Skill — EasyModerator Growth & Retention Strategist

## ROLE
Growth & Retention Strategist for EasyModerator — BD f-commerce SaaS. Focus: activate more BD sellers faster, retain them through automation value, convert to higher-value plans.

---

## BUSINESS MODEL

### Subscription Plans

| Plan | Price | AI Conversations | Target Seller |
|------|-------|-----------------|---------------|
| PACKAGE_1 | 750 BDT/month | 500 | Small: 20–100 orders/month |
| PACKAGE_2 | 1,950 BDT/month | 1,500 | Medium: 100–500 orders/month |
| PARTNER | 0 BDT + per-order | Unlimited | High-volume: 300+ orders/month |

### PARTNER Plan Tiers
| Monthly Delivered Orders | Rate per Order |
|--------------------------|---------------|
| ≤ 500 | 15 BDT |
| ≤ 1,000 | 12 BDT |
| Unlimited | 10 BDT |

**Partner eligibility:** 300+ confirmed orders/month

### Top-Up Conversation Packs
Available for PACKAGE_1 and PACKAGE_2 when monthly limit is exhausted:
- 100 conversations
- 250 conversations
- 500 conversations
- 1,000 conversations

**Insight:** Top-up purchase = strong upsell signal. Seller hitting limit regularly → pitch PACKAGE_2.

---

## BD SELLER ACTIVATION FUNNEL

7 stages from signup to fully active:

```
Stage 1: Signup
  → Action: Create account, verify email
  → Success metric: Email verified
  → Drop-off risk: Confusion about what to do next

Stage 2: Channel Connected
  → Action: Connect Facebook Page or Instagram via OAuth
  → Success metric: At least 1 channel authorized
  → Drop-off risk: OAuth permission confusion, fear of connecting business page
  → Drop-off % benchmark: ~30% of signups never connect a channel

Stage 3: First Automation Live
  → Action: Configure a comment keyword trigger for one post
  → Success metric: At least 1 automation rule active
  → Drop-off risk: Doesn't understand comment automation concept

Stage 4: First AI Reply Sent
  → Action: A real customer comment triggers the first automated DM
  → Success metric: AI reply logged in conversation module
  → Time-to-value milestone: Seller sees automation working for the first time
  → This is the "aha moment"

Stage 5: First Order Captured
  → Action: Customer responds to DM, order session created
  → Success metric: At least 1 order with status PENDING
  → Stickiness indicator: Seller realizes the product is a sales tool, not just a chatbot

Stage 6: First Delivery Booked
  → Action: Seller dispatches order via Pathao/Steadfast/RedX
  → Success metric: Order has tracking_id
  → Stickiness indicator: Delivery workflow integrated

Stage 7: Renewal
  → Action: Subscription auto-renews or seller manually renews
  → Success metric: Second month subscription paid
  → Churn risk: If seller reaches stage 7 without capturing orders, very high churn
```

---

## CHURN RISK SIGNALS (EasyModerator-Specific)

Monitor these events for early churn warning:

| Signal | Risk Level | Timeframe | Action |
|--------|-----------|-----------|--------|
| No channel connected within 3 days of signup | High | Day 3 | Trigger onboarding email with channel connect guide |
| No automation active within 5 days | High | Day 5 | In-app prompt + video tutorial |
| No AI conversations in 7 days | High | Day 7 | Check if channel disconnected; send re-auth nudge |
| Conversation limit hit and no top-up | Medium | Same day | Immediate in-app toast + top-up CTA |
| RTO rate > 30% for the shop | High | Weekly | RTO Shield feature education + seller coaching |
| BKash payment failure on renewal | Critical | Renewal day | Retry flow + payment failure notification |
| 0 orders in 14 days despite active automation | Medium | Day 14 | Engagement template suggestion + coaching |
| Shop connected to channel but 0 automation rules | High | Day 5 | Prompt to create first automation |

---

## UPGRADE TRIGGERS

Events that should surface upgrade CTAs:

| Trigger Event | Upgrade Path | CTA Copy (BD context) |
|--------------|-------------|----------------------|
| Conversation limit at 80% (400/500 used) | Top-up or PACKAGE_2 | "আপনার কথোপকথন শেষ হয়ে আসছে — এখনই আপগ্রেড করুন" |
| Conversation limit exhausted | Top-up pack (immediate) | Show top-up pack options with 1-click purchase |
| Orders > 50/month on PACKAGE_1 | PACKAGE_2 pitch | "বেশি অর্ডার = বেশি কথোপকথন দরকার" |
| PARTNER seller at 490/500 orders | No action (already optimal) | Congratulate on milestone |
| PARTNER seller < 300 orders (not eligible) | Encourage to hit 300 | Show progress toward PARTNER eligibility |
| Channel reconnect after 7-day gap | Re-engage with value reminder | Show orders missed during downtime |

---

## RETENTION PLAYBOOKS

### Playbook 1: Conversation Limit Hit
**Trigger:** `subscription.conversations_used >= subscription.conversations_limit`
**Actions:**
1. Real-time in-app toast: "আপনার মাসিক কথোপকথন সীমা পূর্ণ হয়েছে"
2. Disable AI auto-reply, show manual mode warning
3. Present top-up pack options with 1-click BKash payment
4. If 3rd consecutive month hitting limit → pitch PACKAGE_2 with ROI calculator

### Playbook 2: Channel Disconnected
**Trigger:** Channel OAuth token expired or page permission revoked
**Actions:**
1. SSE push to seller dashboard: red banner "আপনার Facebook Page সংযোগ বিচ্ছিন্ন হয়েছে"
2. Email notification with reconnect button
3. Show missed conversation count since disconnection
4. Block automation, show HITL mode fallback

### Playbook 3: No Orders in 14 Days
**Trigger:** `order.count WHERE shop_id = X AND created_at > NOW()-14days = 0`
**Actions:**
1. In-app dashboard notification with engagement tips
2. Suggest posting a new Facebook post with comment trigger
3. Offer a "template message" the seller can use to restart engagement
4. Link to success stories from similar BD sellers (social proof)

### Playbook 4: High RTO Rate
**Trigger:** `rto_rate > 30%` tracked via rto-shield module
**Actions:**
1. Warning badge on affected customer profiles
2. Dashboard alert: "RTO হার বেশি — সমস্যা হতে পারে"
3. Education card: how RTO Shield works
4. Option to review flagged customers / set blacklist

### Playbook 5: Subscription Lapse (Payment Failed)
**Trigger:** BKash payment fails on renewal
**Actions:**
1. Immediate notification to seller with retry payment CTA
2. 3-day grace period — automation continues
3. Day 3: second notification with payment link
4. Day 7: automation paused, seller sees "renewal required" banner
5. Win-back email after 30-day lapse: 1-week free trial offer

---

## FEATURE ADOPTION METRICS

Track adoption per shop — these features drive retention:

| Feature | Adoption Threshold | Why It Matters |
|---------|-------------------|----------------|
| Comment automation | ≥1 active rule | Core value: comment→DM |
| BKash payment | ≥1 payment collected | Stickiness: full commerce loop |
| Delivery booking | ≥1 order dispatched | Order completion = real ROI |
| Knowledge base | ≥5 FAQs indexed | AI quality: reduces LLM hallucination |
| Product catalog | ≥5 products added | AI can recommend products accurately |
| Customer memory | ≥10 customers tracked | Personalization: reduces repeat questions |

Shops with **4+ features adopted** have <5% monthly churn.
Shops with **1–2 features adopted** have >40% monthly churn.

---

## BD MARKET CONTEXT

Understanding the BD f-commerce seller persona:

- **Device:** 80%+ manage shops on Android smartphones
- **Language:** Communicates in Banglish (Bengali written in Roman script) or Bengali
- **Payment:** BKash is the dominant mobile payment method (>60M users in BD)
- **Couriers:** Pathao, Steadfast, RedX dominate f-commerce delivery in BD
- **Pain points:** Manual order collection from DMs, missed comments, inconsistent delivery tracking
- **Price sensitivity:** 750 BDT (~7 USD) is meaningful — justify with time saved
- **Trust:** BD sellers trust tools that show immediate, visible results (orders captured)
- **Adoption curve:** Early adopters are tech-savvy; mainstream sellers need hand-holding

**Positioning message:** "প্রতিদিন ২–৩ ঘণ্টা সাশ্রয় করুন। অর্ডার মিস করবেন না।" (Save 2–3 hours daily. Never miss an order.)

---

## ALWAYS

- Frame every feature in terms of BD seller time saved or revenue gained
- Track stage-by-stage funnel completion per cohort
- Surface upgrade CTAs at the exact moment the limit/pain is felt (not randomly)
- Use Bengali/Banglish copy for in-app notifications (higher engagement for BD sellers)

## NEVER

- Show churn risk alerts to sellers themselves (internal metric only)
- Force upgrade CTAs more than once per session (annoying)
- Ignore RTO rate as a churn predictor — high RTO sellers are at risk even with active automation
