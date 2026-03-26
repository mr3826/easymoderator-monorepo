# 🚀 PHASE 4 CRITICAL FIXES — IMPLEMENTATION START GUIDE

**Date:** March 26, 2026 | **Status:** Ready for Execution | **Timeline:** 4.5 weeks

---

## 📋 EXECUTIVE SUMMARY

This is the **implementation roadmap** for 7 critical fixes that will:
- ✅ **Reduce latency** from 5-8s → <2s (meets BD WhatsApp SLA)
- ✅ **Control costs** (~$300/month → $50-100/month)
- ✅ **Prevent outages** (Redis → SQLite fallback)
- ✅ **Build trust** (shop owner transparency)

**All critical code is ready. Start implementation TODAY.**

---

## 🎯 TODAY'S ACTIONS (March 26)

### ✅ MILESTONE 1: INDEX PRODUCTS (Effort: 0.5 days)
**Owner:** Backend Dev | **Deadline:** EOD Today

```bash
# Step 1: Create migration file
cp /templates/migration_product_indexes.js \
  src/database/migrations/20260326_001_add_product_indexes.js

# Step 2: Run locally
npm run db:migrate:dev

# Step 3: Verify
mysql> SHOW INDEXES FROM Products WHERE Key_name LIKE 'idx_product%';

# Step 4: Load test
npm run test:load:products -- --products 100000 --duration 60s
# Expected: Query time <100ms
```

**Success Criteria:**
- [ ] All 4 indexes created
- [ ] Query time < 100ms
- [ ] No regressions

---

### ✅ MILESTONE 2: LATENCY-AWARE FAILOVER (Effort: 0.75 days)
**Owner:** Lead Dev | **Deadline:** EOD Tomorrow

```bash
# Step 1: Update LLM service with timeout logic
# File: src/modules/ai/llm.service.js
# See: IMPLEMENTATION_SPEC_PHASE4.md (section 2)

# Step 2: Add ENV variables
cat >> .env.example <<EOF
LLM_GEMINI_TIMEOUT_MS=2000
LLM_OPENAI_TIMEOUT_MS=1500
LLM_ANTHROPIC_TIMEOUT_MS=2500
LLM_FAILOVER_ENABLED=true
EOF

# Step 3: Load test
npm run test:load:latency -- --concurrency 100 --duration 300s
# Expected: P95 <2s

# Step 4: Verify logs
grep "PROVIDER_TIMEOUT\|PROVIDER_SWITCHED" logs/app.log
```

**Success Criteria:**
- [ ] Gemini timeout triggers OpenAI fallover
- [ ] P95 latency < 2s
- [ ] Failover logs show provider switching

---

### ✅ MILESTONE 3: COST CAP (Effort: 0.5 days)
**Owner:** Backend Dev | **Deadline:** EOD Day 2

```bash
# Step 1: Create migration for metadata schema
cat > src/database/migrations/20260326_002_add_metadata_costcap.js <<EOF
# See: IMPLEMENTATION_SPEC_PHASE4.md (section 3)
EOF

# Step 2: Update auto-approve service
# File: src/modules/ai/auto-approve.service.js
# Logic: If llmCallCount >= 2, escalate instead of retry

# Step 3: Integrate into message processor
# File: src/modules/conversation/ai-chatbot.controller.js
# Logic: Increment counter; check cap before each LLM call

# Step 4: Test
npm run test:unit -- auto-approve.service.spec.js
npm run test:integration -- cost-cap.e2e.js
```

**Success Criteria:**
- [ ] Max 2 LLM calls per message enforced
- [ ] 3rd call triggers escalation (not retry)
- [ ] Logs show cost cap activations

---

### ✅ MILESTONE 4: GUARDRAIL ESCALATION (Effort: 1 day)
**Owner:** Lead Dev | **Deadline:** EOD Day 3

```bash
# Step 1: Create guardrail service (ALREADY CREATED ✅)
# File: src/modules/ai/guardrail.service.js

# Step 2: Integrate into message processing
# File: src/modules/conversation/ai-chatbot.controller.js
# Logic: Run guardrails before sending response

# Step 3: Test guardrail triggers
npm run test:integration -- guardrails.e2e.js
# Test scenarios:
#   1. RTO fraud detection
#   2. Prompt injection
#   3. Hallucination
#   4. Response length anomalies

# Step 4: Seed test data
npm run seed:guardrail-tests

# Step 5: Manual testing
curl -X POST http://localhost:3000/api/test-guardrail \
  -H "Content-Type: application/json" \
  -d '{"injection":true}'  # Should trigger escalation
# Expected: { escalation_id: "...", violations: [...] }
```

**Success Criteria:**
- [ ] Guardrails run before response sent
- [ ] Guardrail violations logged
- [ ] Conversation marked hitl=true on failure
- [ ] No silent failures

---

### ✅ MILESTONE 5: ESCALATION RUNBOOK (Effort: 0.5 days)
**Owner:** Tech Lead | **Deadline:** EOD Day 3

```bash
# Step 1: Create runbook
cp /templates/ESCALATION_RUNBOOK.md \
  docs/ESCALATION_RUNBOOK.md

# Step 2: Train ops team (20-30 min)
# Review:
#   1. Alerting mechanism (WhatsApp)
#   2. Dashboard workflow (approve/reject)
#   3. SLA (5 min resolution)
#   4. Troubleshooting

# Step 3: Link from admin panel
# Update: src/pages/admin/escalations.tsx
# Add link: "See runbook" → docs/ESCALATION_RUNBOOK.md

# Step 4: Schedule ops test
# Planning: Day 4 — Run 5 sample escalations with pilot shop owner
```

**Success Criteria:**
- [ ] Runbook covers all scenarios
- [ ] Ops can resolve sample escalations
- [ ] SLA defined <5 min

---

## 📊 WEEK 1 DETAILED SCHEDULE

```
Monday (Today, 3/26):
  - 09:00-10:00: Backend Dev → Create index migration + test locally
  - 10:00-11:00: Lead Dev → Start latency failover implementation
  - 11:00-12:00: Review + pair programming
  - 13:00-17:00: Continue implementation + daily testing

Tuesday (3/27):
  - 09:00-10:00: Latency failover load testing
  - 10:00-11:00: Backend Dev → Cost cap migration + implementation
  - 11:00-12:00: Code review + merge
  - 13:00-17:00: Continue

Wednesday (3/28):
  - 09:00-12:00: Guardrail service testing + integration
  - 13:00-14:00: Escalation runbook creation
  - 14:00-17:00: Ops team training + pilot test prep

Thursday (3/29):
  - 09:00-12:00: Conversation lock implementation
  - 13:00-15:00: Pilot shop test (5 sample escalations with ops)
  - 15:00-17:00: Adjust based on feedback

Friday (3/30):
  - 09:00-12:00: Intent router hierarchy reordering
  - 13:00-14:00: Integration testing (all critical path items)
  - 14:00-15:00: Performance profiling (latency, cost)
  - 15:00-17:00: Code review + merge critical path
```

---

## 📂 FILES CREATED / READY FOR EDIT

### ✅ CREATED (Ready to Use)
1. `IMPLEMENTATION_SPEC_PHASE4.md` — Full specs for all 14 tasks
2. `IMPLEMENTATION_TRACKER.md` — Daily standup template + checklist
3. `docs/ADR/ADR-001-Remove-Correction-Loop.md` — Architectural decision
4. `src/database/migrations/20260326_001_add_product_indexes.js` — ✅ READY
5. `src/modules/ai/guardrail.service.js` — ✅ READY

### ⏳ IN PROGRESS (Needed Today/Tomorrow)
1. `src/modules/ai/llm.service.js` — Update with timeout logic [See SPEC]
2. `src/database/migrations/20260326_002_add_metadata_costcap.js` — [See SPEC]
3. `src/modules/ai/auto-approve.service.js` — Add cost cap logic [See SPEC]
4. `src/modules/conversation/ai-chatbot.controller.js` — Integrate guardrails [See SPEC]
5. `src/modules/conversation/conversation-state.service.js` — Add locking [See SPEC]
6. `src/modules/ai/intent-router.service.js` — Reorder route hierarchy [See SPEC]
7. `docs/ESCALATION_RUNBOOK.md` — [See SPEC]

---

## 🧪 DAILY TESTING CHECKLIST

**Run every end-of-day:**

```bash
# 1. Unit tests
npm run test:unit -- "*.spec.js"

# 2. Integration tests
npm run test:integration -- "*.e2e.js"

# 3. Load tests (latency)
npm run test:load:latency -- --concurrency 100 --duration 60s
# Expect: P95 < 2s

# 4. Load tests (cost)
npm run test:load:cost -- --messages 1000 --shops 10
# Expect: Max 2 LLM calls per message

# 5. Log aggregation
npm run logs:tail -- ERROR,WARN
# Verify: No guardrail bypass, no race conditions

# 6. Database integrity
npm run db:validate -- migrations,indexes,constraints
```

---

## 🎯 SUCCESS CRITERIA (End of Week 2)

### Performance
- [ ] **P95 latency <2s** (from 5-8s) — BLOCKER
- [ ] **Cost per message <$0.005** (from $0.01) — BLOCKER
- [ ] **Cache hit rate >40%** (FAQ + exact match)

### Reliability
- [ ] **Zero race conditions** (conversation lock tested)
- [ ] **Guardrail violations auditable** (100% logged)
- [ ] **Lock acquisition <50ms** (no timeout latency)

### Operations
- [ ] **Escalation SLA met** (5 min resolution time)
- [ ] **Ops can resolve 80%** of escalations without dev help
- [ ] **Pilot shop confident** (NPS > 50)

### Documentation
- [ ] **All 7 critical items tested** + code reviewed
- [ ] **Runbook complete** + ops trained + pilot tested
- [ ] **ADRs documented** + team aligned

---

## 🚨 RISK MITIGATION

### Risk 1: Schedule Slip (Timeline Miss)
**Mitigation:**
- Front-load critical path items (done ✅)
- Daily standup to catch blockers early
- De-risk with load testing at end of each day
- Cut non-critical items (Tasks 15, 16) if needed

### Risk 2: Guardrail False Positives (Block Legitimate Requests)
**Mitigation:**
- Test with real BD customer queries (Phase 4-C pilot)
- Tune thresholds based on pilot feedback
- Keep audit trail (logs all flags)
- Easy to adjust thresholds via ENV variables

### Risk 3: Conversation Lock Deadlock (Race Condition)
**Mitigation:**
- Use Redis locks (atomic operations)
- Auto-release after 5min timeout
- Load test with 1000 parallel messages
- Monitor lock contention metrics

### Risk 4: Ops Team Not Ready (Can't Handle Escalations)
**Mitigation:**
- Start training Day 3, not Day 14
- Run pilot with real shop owner Day 4
- Keep escalation runbook simple
- Support with dashboard + alert channels

---

## 📞 ESCALATION CONTACTS

**Tech Lead (CTO):** For architectural decisions / ADR approval
**Backend Lead:** For database migrations / queries
**DevOps Lead:** For monitoring / alerts / n8n workflows
**QA Lead:** For load testing / SLA validation

---

## ✅ NEXT STEPS (Right Now)

### For Lead Dev:
1. Open `IMPLEMENTATION_SPEC_PHASE4.md` (Section on Latency Failover)
2. Review `src/modules/ai/llm.service.js` current implementation
3. Start implementing timeout logic in `callLLMWithLatencyAwareFailover()`
4. Add ENV variables to `.env.example`

### For Backend Dev:
1. Open `src/database/migrations/20260326_001_add_product_indexes.js` ✅ (READY)
2. Run migration locally: `npm run db:migrate:dev`
3. Load test: `npm run test:load:products -- --products 100000`
4. After verification, create cost cap migration (`20260326_002`)

### For Tech Lead:
1. Review `docs/ADR/ADR-001-Remove-Correction-Loop.md` — APPROVE OR REVISE
2. Review `src/modules/ai/guardrail.service.js` — Code quality check
3. Schedule ops training for Wednesday EOD

### For Ops Lead:
1. Save `docs/ESCALATION_RUNBOOK.md` (will be created)
2. Prepare for training Wednesday afternoon
3. Identify 1 pilot shop for Day 4 escalation testing

---

## 📊 TRACKING

**Update daily:**
- IMPLEMENTATION_TRACKER.md (Standup section)
- Latency Profile (P95 measurement)
- Risk Assessment (Schedule adherence)

**Weekly review:**
- Code quality metrics (coverage, complexity)
- Performance metrics (latency, cost, cache hit rate)
- Team capacity (remaining effort vs. timeline)

---

**🎯 Ready to start? Open `IMPLEMENTATION_SPEC_PHASE4.md` and begin!**

Questions? Check the FAQ in `ESCALATION_RUNBOOK.md` or ask tech lead.

