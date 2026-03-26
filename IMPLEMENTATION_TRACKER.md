# Phase 4 Implementation Tracker

**Start Date:** March 26, 2026
**Target Completion:** April 23, 2026
**Team:** Lead Dev + Backend Dev + DevOps (part-time)

---

## CRITICAL PATH TRACKER (Week 1-2)

### ✅ Task 1: INDEX PRODUCTS (WSJF 54)
**Owner:** Backend Dev | **Effort:** 0.5 days | **Status:** 🚨 TODO
**Deadline:** Day 1 EOD

**Steps:**
- [ ] Create migration: `src/database/migrations/20260326_001_add_product_indexes.js`
- [ ] Test migration locally
- [ ] Run on staging: verify <5min execution
- [ ] Load test: 100k products, measure query time
- [ ] **Deployment:** Run migration + verify indexes

**Files to Create:**
1. `src/database/migrations/20260326_001_add_product_indexes.js` ← [SEE SPEC]

**Acceptance Criteria:**
- [ ] Query time < 100ms at 100k products
- [ ] No regression on other queries
- [ ] Migration is idempotent (safe to re-run)

**Blockers:** None
**Depends on:** Nothing

---

### ✅ Task 2: LATENCY-AWARE FAILOVER (WSJF 34)
**Owner:** Lead Dev | **Effort:** 0.75 days | **Status:** 🚨 TODO
**Deadline:** Day 2 EOD

**Steps:**
- [ ] Update `src/modules/ai/llm.service.js` with timeout-based failover
- [ ] Update provider selection logic
- [ ] Add ENV variables for timeout tuning
- [ ] Unit test: simulate Gemini timeout, verify switch to OpenAI
- [ ] Load test: 100 concurrent requests, measure P95
- [ ] **Deployment:** Deploy + verify P95 < 2s

**Files to Modify:**
1. `src/modules/ai/llm.service.js` ← [SEE SPEC]
2. `.env.example` (add timeout configs)

**Acceptance Criteria:**
- [ ] Gemini timeout triggers failover to OpenAI (not full 4s wait)
- [ ] P95 latency < 2s consistently
- [ ] Failover logs show provider switching
- [ ] Cost unchanged (Gemini still preferred when fast)

**Blockers:** None
**Depends on:** Task 1 (indexes, for overall latency baseline)

---

### ✅ Task 3: COST CAP PER MESSAGE (WSJF 48)
**Owner:** Backend Dev | **Effort:** 0.5 days | **Status:** 🚨 TODO
**Deadline:** Day 2 EOD

**Steps:**
- [ ] Add `metadata.llmCallCount` tracking to Conversations
- [ ] Create migration for metadata schema
- [ ] Update auto-approve service to enforce cost cap
- [ ] Update ai-chatbot controller to increment counter
- [ ] Test: trigger 2 LLM calls, verify 3rd escalates
- [ ] **Deployment:** Deploy migration + code

**Files to Create/Modify:**
1. `src/database/migrations/20260326_002_add_metadata_costcap.js` ← [SEE SPEC]
2. `src/modules/ai/auto-approve.service.js` ← [UPDATE]
3. `src/modules/conversation/ai-chatbot.controller.js` ← [UPDATE]

**Acceptance Criteria:**
- [ ] Conversations.metadata stores llmCallCount
- [ ] Max 2 LLM calls per message enforced
- [ ] 3rd call triggers escalation (not retry)
- [ ] Logs show cost cap activations

**Blockers:** None
**Depends on:** Nothing

---

### ✅ Task 4: GUARDRAIL ESCALATION (WSJF 30)
**Owner:** Lead Dev | **Effort:** 1 day | **Status:** 🚨 TODO
**Deadline:** Day 3 EOD

**Steps:**
- [ ] Create `src/modules/ai/guardrail.service.js` with all checks
- [ ] Implement RTO fraud detection integration
- [ ] Implement prompt sanitizer integration
- [ ] Implement hallucination detector
- [ ] Update ai-chatbot controller to call guardrails
- [ ] Add conversation.hitl propagation
- [ ] Unit tests for each guardrail type
- [ ] **Deployment:** Deploy service + update controller

**Files to Create/Modify:**
1. `src/modules/ai/guardrail.service.js` ← [SEE SPEC]
2. `src/modules/conversation/ai-chatbot.controller.js` ← [INTEGRATE]

**Acceptance Criteria:**
- [ ] Guardrails run before response sent
- [ ] Guardrail failures set hitl=true
- [ ] Violations logged + escalated
- [ ] No silent failures

**Blockers:** None
**Depends on:** Task 3 (cost cap logic should work with guardrails)

---

### ✅ Task 5: ESCALATION RUNBOOK (WSJF 36)
**Owner:** Tech Lead | **Effort:** 0.5 days | **Status:** 🚨 TODO
**Deadline:** Day 3 EOD

**Steps:**
- [ ] Create docs/ESCALATION_RUNBOOK.md
- [ ] Document alert workflow
- [ ] Document approval/rejection process
- [ ] Document troubleshooting steps
- [ ] Share with ops team
- [ ] **Deployment:** Link from admin dashboard

**Files to Create:**
1. `docs/ESCALATION_RUNBOOK.md` ← [SEE SPEC]
2. Update `README.md` to link to runbook

**Acceptance Criteria:**
- [ ] Runbook covers all escalation scenarios
- [ ] SLA defined (5 min resolution time)
- [ ] Troubleshooting steps provided
- [ ] Ops team confirmed readiness

**Blockers:** Task 4 (guardrails must be implemented first)
**Depends on:** Task 4

---

### ✅ Task 6: CONVERSATION LOCK (WSJF 19.3)
**Owner:** Lead Dev | **Effort:** 1.5 days | **Status:** 🚨 TODO
**Deadline:** Day 4 EOD

**Steps:**
- [ ] Add Redis lock utilities to conversation-state.service.js
- [ ] Implement acquireLock() / releaseLock()
- [ ] Create migration for lock metadata columns
- [ ] Wrap message processing with lock
- [ ] Handle HITL message queueing
- [ ] Load test: parallel messages while HITL=true
- [ ] Measure lock acquisition latency
- [ ] **Deployment:** Deploy migration + service update

**Files to Create/Modify:**
1. `src/database/migrations/20260326_003_add_lock_metadata.js` ← [SEE SPEC]
2. `src/modules/conversation/conversation-state.service.js` ← [UPDATE]
3. `src/modules/conversation/ai-chatbot.controller.js` ← [UPDATE]

**Acceptance Criteria:**
- [ ] Conversations locked during HITL
- [ ] Parallel messages don't corrupt history
- [ ] Lock acquisition < 50ms
- [ ] Lock auto-release after 5min
- [ ] Zero race conditions in load test

**Blockers:** Task 4 (guardrails set hitl flag)
**Depends on:** Task 4

---

### ✅ Task 7: INTENT ROUTER HIERARCHY (WSJF 13.5)
**Owner:** Lead Dev | **Effort:** 2 days | **Status:** 🚨 TODO
**Deadline:** Day 5-6 EOD

**Steps:**
- [ ] Add SQL product matching logic
- [ ] Implement NLP entity extraction
- [ ] Implement intent classification
- [ ] Reorder routing: cache → SQL → semantic → LLM
- [ ] Add latency telemetry per route
- [ ] Test 100 price queries (verify SQL route)
- [ ] Test 100 FAQ queries (verify semantic route)
- [ ] Test 50 complex queries (verify LLM route)
- [ ] **Deployment:** Deploy updated router

**Files to Create/Modify:**
1. `src/modules/ai/intent-router.service.js` ← [MAJOR UPDATE]
2. Add NLP library to package.json (e.g., `compromise`)

**Acceptance Criteria:**
- [ ] 40% of queries use cache/SQL (not LLM)
- [ ] P95 latency < 2s
- [ ] Latency histogram shows 3 buckets (cache, SQL, LLM)
- [ ] Cost per message drops (fewer LLM calls)

**Blockers:** Tasks 1, 2, 4 (need indexes, failover, guardrails first)
**Depends on:** Tasks 1, 2, 4

---

## NON-CRITICAL PATH (Week 2, Parallelize with Above)

### 8️⃣ Task 8: SQLITE FALLBACK QUEUE (WSJF 17.3)
**Owner:** DevOps | **Effort:** 1.5 days | **Status:** ⏳ READY
**Deadline:** Day 4 EOD

*Detailed spec in IMPLEMENTATION_SPEC_PHASE4.md*

### 9️⃣ Task 9: REAL-TIME TOKEN COUNTER (WSJF 18.4)
**Owner:** Backend Dev | **Effort:** 1.25 days | **Status:** ⏳ READY
**Deadline:** Day 5 EOD

*Detailed spec in IMPLEMENTATION_SPEC_PHASE4.md*

### 🔟 Task 10: OFFLINE FAQ CACHE (WSJF 24)
**Owner:** Backend Dev | **Effort:** 1 day | **Status:** ⏳ READY
**Deadline:** Day 5 EOD

*Detailed spec in IMPLEMENTATION_SPEC_PHASE4.md*

### 1️⃣1️⃣ Task 11: SELECTIVE BULLMQ (WSJF 17)
**Owner:** Lead Dev | **Effort:** 1 day | **Status:** ⏳ READY
**Deadline:** Day 6 EOD

*Detailed spec in IMPLEMENTATION_SPEC_PHASE4.md*

### 1️⃣2️⃣ Task 12: n8n WHATSAPP ALERTS (WSJF 21)
**Owner:** DevOps | **Effort:** 1 day | **Status:** ⏳ READY
**Deadline:** Day 7 EOD

*Detailed spec in IMPLEMENTATION_SPEC_PHASE4.md*

### 1️⃣3️⃣ Task 13: COST ATTRIBUTION (WSJF 25.3)
**Owner:** Frontend + Backend | **Effort:** 0.75 days | **Status:** ⏳ READY
**Deadline:** Day 7 EOD

*Detailed spec in IMPLEMENTATION_SPEC_PHASE4.md*

### 1️⃣4️⃣ Task 14: OPS TRAINING PILOT (WSJF 17.3)
**Owner:** Lead Dev + DevOps | **Effort:** 0.75 days | **Status:** ⏳ READY
**Deadline:** Day 8 EOD

*Detailed spec in IMPLEMENTATION_SPEC_PHASE4.md*

---

## DEFERRABLE (If Timeline Slips >2 days)

### Task 15: SHOP DASHBOARD (WSJF 12)
**Owner:** Frontend | **Effort:** 1.25 days | **Status:** 📊 DEFER
**Note:** Not critical; SMS alerts sufficient for MVP

### Task 16: BENGALI POST-PROCESSING (WSJF 9)
**Owner:** Backend | **Effort:** 1 day | **Status:** 📊 DEFER
**Note:** Phase 5; acceptable quality loss for MVP

---

## DEPLOYMENT CHECKLIST (Before Production)

### Code Review & Testing
- [ ] All 7 critical path tasks code reviewed + approved
- [ ] All migrations tested on staging
- [ ] Load tests pass (P95 <2s)
- [ ] Outage simulations pass (Redis down / Gemini timeout)

### Ops Readiness
- [ ] Ops team trained on runbook
- [ ] Alert channels configured (WhatsApp to shop owner)
- [ ] Escalation queue monitored
- [ ] Backup procedures documented

### Pilot Shop Onboarding
- [ ] 1 shop selected as pilot
- [ ] Guardrails tested with real data
- [ ] Ops responds to 5 sample escalations
- [ ] Shop owner confirms confidence in system

### Monitoring Setup
- [ ] Sentry + logs configured
- [ ] Key metrics dashboard created (latency, escalations, cost)
- [ ] Alerts set for SLA violations

---

## DAILY STANDUP TEMPLATE

**Each day, update:**

```
## [DATE] - Phase 4 Implementation Standup

### Completed Yesterday
- [ ] Task X — [% complete]
- [ ] Task Y — [% complete]

### Today's Focus
- [ ] Task A — [target: X%]
- [ ] Task B — [target: X%]

### Blockers & Help Needed
- Blocker 1: [description]
  - Help needed: [from team member]
  - ETA to unblock: [date]

### Latency Profile (from daily tests)
- P50: [ms]
- P95: [ms]
- P99: [ms]
- Status: 🟢 ON TRACK / 🟡 AMBER / 🔴 RED

### Risk Assessment
- Critical path: [% schedule adherence]
- SLA confidence: [HIGH/MEDIUM/LOW]
```

---

## SUCCESS METRICS (Week 2 End)

### Performance
- [ ] P95 latency < 2s (from current 5-8s)
- [ ] Cost per message < $0.005 (from $0.01)
- [ ] Cache hit rate > 40%

### Reliability
- [ ] Guardrail violations logged + escalated 100%
- [ ] Zero race conditions on HITL conversations
- [ ] Lock acquisition < 50ms

### Operations
- [ ] Escalation SLA: 5 min resolution time
- [ ] Ops team resolving 80% of escalations without dev help
- [ ] Pilot shop owner confident (NPS > 50)

### Documentation
- [ ] Runbook complete + ops trained
- [ ] ADRs documented + approved
- [ ] All code commented + reviewed

