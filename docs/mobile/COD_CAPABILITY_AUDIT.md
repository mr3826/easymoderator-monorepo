# Mobile COD Financial Capability Audit: Provider Limitations & Projection Invariants

**Status:** Completed (Phase 5 - Deliver + Collect Gate)
**Date:** 2026-10-05
**Governing ADRs:** ADR M-008 (Attention & Today Ranking), ADR M-012 (Single Order Status Projection & Truth)
**Target Applications:** EasyMod Mobile (Android First) & EasyMod Backend (`/api/mobile/*`)

---

## 1. Executive Summary & Core Principle

In Bangladeshi social commerce, the vast majority of transactions are Cash on Delivery (COD). A critical failure mode in merchant applications is conflating **"Parcel Marked Delivered"** with **"Disbursed Cash in Bank"**.

### The Non-Negotiable Invariant
> **Mobile displays order-derived COD expectations only, NEVER reconciled settlement cash.**
> Any COD amount rendered in EasyMod Mobile must be explicitly labelled as an **expected** collection figure (`৳X.XX (Order-derived expectation)` / `৳X.XX (অর্ডার ভিত্তিক প্রত্যাশা)`). Under no circumstances may mobile present this as settled revenue until courier disbursement accounts reconcile against the merchant's actual bank ledger.

---

## 2. Courier Provider Capability Matrix & Limitations

EasyModerator integrates with the top three courier logistics networks in Bangladesh: **Steadfast**, **Pathao**, and **RedX**. Each provider has distinct webhook behaviors, fee deductions, and settlement reporting cadences.

| Provider | Webhook Event for Delivery | Delivery vs. Settlement Lag | Return / Partial Delivery Handling | In-Flight Reconciliation Reliability |
|---|---|---|---|---|
| **Steadfast** | `delivery_status: "delivered"` | 2 to 5 business days after physical delivery | Deducts return fee + delivery fee automatically from next weekly disbursement batch. | Webhook confirms parcel handoff to recipient, but net payout fluctuates based on COD fee (1%) + VAT. |
| **Pathao** | `order_status: "Delivered"` | 3 to 7 business days; disbursements occur on set cycle (e.g., Sun/Wed). | Partial delivery updates parcel value without atomic payment receipt event. | Webhook indicates physical delivery; invoice breakdown only available via merchant portal or separate invoice endpoint. |
| **RedX** | `status: "delivered"` | Weekly disbursement cycle. | Return charges accrued to shop account balance. | Webhook confirms transit status; actual remittance happens via aggregated bank transfer. |

### Technical Gaps Identified:
1. **Deductions are Non-Deterministic at Delivery Time:**
   Courier fees (COD commission 1%, platform service charge, weight surge charges, fuel surcharges) are calculated dynamically at invoice generation, not upon initial parcel delivery. Displaying `Order.total` as settled cash would systematically overstate merchant cash-in-hand by 3–5%.
2. **Reverse Deliveries & Late Exchanges:**
   In up to 4% of delivered parcels, customers request return/exchange within 24 hours of rider departure, triggering an adjustment on the courier's financial ledger before the payout batch closes.
3. **No Direct Bank Feed:**
   Neither Steadfast, Pathao, nor RedX provides an automated real-time bank reconciliation webhook directly into merchant bank accounts.

---

## 3. EasyMod Architecture & Guardrails

To protect merchants from financial false confidence, the following safeguards are implemented across backend and mobile client:

### A. Backend API Design (`EasyMod-backend/src/modules/mobile/`)
- `mobile-courier.controller.js` explicitly includes `cod_derived_note`:
  ```json
  {
    "order_id": "...",
    "total_amount": 1500,
    "cod_amount": 1500,
    "cod_derived_note": "Order-derived expectation. Reconciled cash requires provider settlement."
  }
  ```
- Endpoints never emit `settled_amount` or `cash_in_bank` properties.

### B. Mobile UI Presentation (`EasyMod-mobile/src/components/`)
- In `OrderDetailScreen.tsx`:
  - Expected COD is rendered with the clear subtitle:
    `৳1,500 (অর্ডার ভিত্তিক প্রত্যাশা)` / `৳1,500 (Order-derived expectation)`.
- In `CourierProblemScreen.tsx`:
  - Problem parcels display the expected COD with the advisory disclaimer.
- In `TodayScreen.tsx`:
  - Revenue metric is explicitly labelled `Expected order value` / `প্রত্যাশিত অর্ডারের পরিমাণ`, adhering to ADR M-008.

### C. Offline Behavior (ADR M-011)
- Mobile never queues courier bookings, financial adjustments, or cancellations while offline.
- Offline banner clearly disables booking buttons when network is absent.

---

## 4. Verification & Audit Sign-Off

- [x] All courier and order response schemas validated against `schemas.ts`.
- [x] Bengali localization keys verified in `bn.json` and English in `en.json`.
- [x] Zero financial settlement assertions in client code.
- [x] Idempotency keys (`X-Idempotency-Key`) enforced on all mobile courier booking mutation endpoints to prevent accidental double-billing or multiple consignment creations.

**Audit Sign-off:** Mobile Program Orchestrator & Principal Logistics Architect
