# Pilot Intelligence — Product

Status: Pilot · Owner: Product + Engineering · Rollout: per shop, platform-controlled ([07-operations-runbook.md](07-operations-runbook.md))

This covers the two pilot features: Customer 360 Lite, with Sales
Opportunities inside it, and RTO Shield v2 / Order Confidence. Both are off for
every shop until a platform admin turns them on.

---

## 1. Customer 360 Lite

### Merchant problem

A merchant answering "who is this person and can I trust this order?" has to
piece together the Inbox, the Orders list and memory. Repeat buyers are not
recognised, customers who return parcels are not recognised either, and
nothing records who asked a price question and never ordered.

### What the pilot gives the merchant

**Customers list** at `/customers`.

- Search by name or phone. A full BD mobile number matches however it was
  stored (`017…`, `+88017…`, `88017…`). A partial number is a plain substring
  match.
- Each row shows:
  - status;
  - orders ("2 delivered of 3");
  - delivered value;
  - last activity;
  - whether a sales opportunity is open.
- It works on a phone: cards below the `md` breakpoint and a table above it.

**Customer detail** at `/customers/:id`.

- Identity:
  - name and channel;
  - Page;
  - phone and email when they were legitimately collected;
  - first contact and last activity.
- **Reply window.** Whether Meta's 24-hour window is open, until when, or
  whether the customer opted out.
- **Commerce summary.**
  - Order counts: orders, delivered, returned, cancelled, in progress.
  - Values: ordered value and delivered value.
  - Dates: last order and last delivery.
  - Values are the recorded order totals; nothing is estimated.
- **Delivery risk signal.** The existing RTO Shield check, stated neutrally:
  "No return-risk signal", "Verify before shipping", or "Review before
  shipping".
- **Sales opportunities** for this customer.
- **Orders**, with outcome and Order Confidence decision. An order that is not
  linked to the customer record but shares the phone number is shown with a
  **"Matched by phone"** label.
- **Relationship history**, a timeline of:
  - first contact and conversations;
  - order placed, courier booked, delivered, returned and cancelled;
  - opportunity detected, converted, dismissed and expired.

  A time the platform does not record exactly is marked "approximate". For
  example, a cancellation shows when the order was last updated.

### Customer status (derived, explainable)

Status is computed from recorded facts every time it is shown. It is never an
AI output. The first matching rule wins, and every status carries its reason,
which the merchant sees.

| Status (label) | When | Example reason shown |
| --- | --- | --- |
| `AT_RISK` ("Return history") | returns > 0 and returns ≥ deliveries | "2 returned vs 1 delivered" |
| `INACTIVE` ("Inactive") | no activity for more than 90 days | "No activity for 120 days" |
| `REPEAT_BUYER` ("Repeat buyer") | 2 or more successful deliveries | "3 successful deliveries" |
| `BUYER` ("Buyer") | at least one non-cancelled order | "1 order placed" |
| `INTERESTED` ("Interested") | an open sales opportunity | "Showed buying interest" |
| `NEW` ("New") | none of the above | "No orders yet" |

The words are deliberately neutral. The UI never says "fraud" or "blacklisted
customer": a return history is history, not a verdict about a person.

### Identity

- A customer is one Messenger identity **per shop and per Page**. The same
  person on another shop's Page is a different customer, and nothing is shared
  across shops.
- A customer is never merged because of a name.
- A manually created order without a customer link is associated only when its
  phone normalises to the customer's phone. It is labelled "Matched by phone",
  and no record is changed.
- Merge and unmerge are not part of the pilot.

---

## 2. Sales Opportunities (inside Customers)

### Merchant problem

Purchase intent is scattered across the Inbox and forgotten. Examples: "dam
koto?", "size M ache?", "COD hobe?", "order korbo". There is no list of people
who wanted to buy and did not.

### What it does

A sweep every 10 minutes looks at recent conversations that **have gone quiet
for 30 minutes**. It flags one opportunity per customer when there was:

- a **strong** signal: said they want to order ("order korbo", "নিবো", "I want
  to order"), tried to confirm, changed a cart, or **started checkout and did
  not finish**, with the products from the cart; or
- **two different** buying questions, at least one of them medium:
  availability, size, colour or variant, delivery charge, delivery, payment or
  COD, a product question, or a product photo.

A single price question is not an opportunity.

Signals come from EasyModerator's existing deterministic Bangla, Banglish and
English intent rules, the same rules the AI pipeline uses. Negation is
understood ("order korbo na" is not intent). If the customer's latest relevant
message is an explicit cancel or STOP, no opportunity is created. An opted-out
customer never gets one.

### Opportunity card

Each card shows:

- the customer;
- strength ("Strong interest" or "Interested");
- the reasons in plain language;
- products, when a checkout was started;
- when it was detected;
- the **next step**:
  - "Reply in the Inbox before 14:05": the 24-hour window is open;
  - "Meta's 24-hour reply window has closed…": wait for the customer;
  - "This customer asked not to be messaged.": no follow-up is offered;
  - "Not a Messenger customer — follow up by phone."

The merchant actions are:

- **Open conversation**, in the Inbox;
- **Mark contacted**;
- **Dismiss**, with a reason (not interested, already handled, not a real
  request, other).

### Lifecycle

```
OPEN ──mark contacted──▶ ACTIONED
  │                         │
  ├─ customer orders ───────┼──▶ CONVERTED   (automatic, immediately on order creation)
  ├─ merchant dismisses ────┼──▶ DISMISSED   (audited, with reason)
  └─ 7 days no new signal ──┴──▶ EXPIRED     (ACTIONED expires 14 days after contact)
```

- A dismissed opportunity does not come back unless the customer shows **new**
  buying intent.
- There is at most one live (OPEN or ACTIONED) opportunity per customer.

### Follow-up is manual

EasyModerator does **not** send follow-up messages for the pilot. The merchant
replies in the Inbox, where the normal messaging policy decides whether a
message may be sent. See
[ADR-0008](../adr/0008-manual-follow-up-only.md) for why.

---

## 3. RTO Shield v2 / Order Confidence

### Merchant problem

RTO Shield already refused COD orders from blocked numbers. Its "verify" level,
however, was computed and then thrown away. Couriers were booked for orders
that should first have been confirmed: an incomplete address, a duplicate
order, a number with returns. Each return costs delivery both ways.

### What changes

Before any courier is booked, whether automatically after a chatbot order, on
payment, on confirming a draft, or by the merchant clicking **Book courier**,
EasyModerator checks the order and decides:

| Decision | Meaning | What happens in `enforce` mode |
| --- | --- | --- |
| **Ready to ship** (`READY`) | Nothing needs checking | Booking proceeds as before |
| **Needs verification** (`VERIFY`) | Something should be confirmed with the customer | Booking is paused. **Any** team member confirms it and records how (phone call, chat, in person). |
| **Needs owner review** (`MANUAL_REVIEW`) | A stronger return-risk signal | Booking is paused. Only the **owner or an admin** can approve, and must write why. |

A cancelled or refunded order is never booked.

### Reasons (inputs are data EasyModerator already records)

| Reason shown | Level | Source |
| --- | --- | --- |
| "This number is on a return-risk list" | Owner review | Existing RTO Shield: this shop's block list, or the cross-shop network if the shop takes part |
| "N returned vs M delivered before" (N ≥ 2, N > M) | Owner review | This shop's own order history for the same phone or customer |
| "This number has a return-risk signal" | Verify | Existing RTO Shield verify tier |
| "N earlier return(s)" | Verify | This shop's order history |
| "Another open order for this number in the last 24 hours" | Verify | This shop's orders |
| "Phone number is missing or invalid" | Verify | The order |
| "Address looks incomplete (9 characters)" | Verify | The order (shorter than 15 characters by default) |
| "The order is not confirmed yet" | Verify | The order status is draft or pending |
| "First cash-on-delivery order of ৳15,000" | Verify | Unpaid, at or above ৳10,000 by default, and no earlier delivery |
| "Some checks could not run" | Verify | A lookup failed. The check fails safe to verification and never silently to ready. |

Context is also shown, but it never decides anything:

- "2 delivered, 0 returned before";
- "Paid in advance";
- "First order from this number".

Rules only ever add caution. Good history never removes a reason, so a shared
or borrowed phone number cannot "inherit" someone else's clean record to skip a
check.

### Order detail panel

On every order, the panel shows:

- the decision;
- the reasons, with the numbers behind them;
- a trial-mode note in `shadow` mode;
- the verification or approval form, when the merchant's role allows it;
- who cleared the order and when;
- the delivery outcome once known;
- a history of checks, holds and releases.

The approve form asks for a written reason. Staff see "Only the shop owner or
an admin can approve this order."

If the merchant clicks **Book courier** on a paused order, the booking is not
made. The merchant is told the order needs checking, and the panel refreshes.

### Changes after clearing

A verification or approval is for **the order as it was when it was checked**:
phone, address, amount, payment status, items and customer. If any of those
change, the clearance no longer applies and the order is checked again. The
merchant sees "The order was edited after it was cleared, so it needs checking
again."

### Delivery outcomes

When the courier reports a final **delivered** or **returned** result, it is
recorded once against the order's decision. This feeds the pilot measurement
("of the orders we released as READY, how many came back?") and later
calibration. No machine-learning model is trained in the pilot.

### Modes

| Mode | Effect |
| --- | --- |
| `off` (default) | Exactly the pre-pilot behaviour; nothing is recorded |
| `shadow` | Decisions are recorded and shown, and booking is **never** paused. Measures what would have been held. |
| `enforce` | Booking is paused until the order is verified or approved |

### Limitations (pilot)

- Address completeness is a length heuristic. It cannot tell a complete short
  address from an incomplete long one, which is why it is a verification and
  not a block.
- There is no automatic customer-confirmation message. Verification is recorded
  by the merchant.
- Thresholds are set by the platform during the pilot, not self-served by
  merchants.
- A paused automatic booking is not retried automatically after verification.
  The merchant clicks Book courier.
- Opportunity detection can see only messages from the last 72 hours, and the
  Bangla phrases carry the repository's existing "pending native-language QA"
  note (`stage2-rules.js`).
