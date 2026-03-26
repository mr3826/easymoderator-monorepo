# ADR-001: Replace Correction Loop with Guardrail Escalation

**Date:** March 26, 2026
**Status:** ACCEPTED
**DecisionOwner:** Tech Lead
**ImplementationOwner:** Lead Dev

---

## Context

### Problem
The original architecture assumed a "correction loop" where:
- AI generates response
- Guardrail detects hallucination
- System re-prompts AI to fix the error
- Expected outcome: corrected response

**Issues with this approach:**
1. **Latency:** Re-prompting adds 2-3 seconds per correction attempt
2. **Token waste:** If model has systemic weakness (e.g., stock hallucination), re-prompting likely fails again
3. **Network risk:** BD internet unreliability → each API call is a failure point
4. **Cost explosion:** One user query → 2-3 LLM calls instead of 1

**SLA impact:** 
- Target: <2-3s (BD WhatsApp expectation)
- Current: 5-8s with correction loop (FAILS)

### Technical Constraints
- Gemini P95 latency: 3-4 seconds
- Failover chain needed (Gemini → OpenAI → Anthropic)
- BD internet: 30% packet loss on peak hours (unstable)

### Business Context
- 100 BD shops, 100 messages/day each
- $0.003-$0.01 per message (LLM cost)
- Hallucination rate: ~5%
- At scale: 500 extra corrective API calls/day = $5/day = $150/month hidden cost

---

## Decision

**Remove correction loop. Replace with human escalation.**

### New Flow
```
Customer message
    ↓
Intent Router (cache/SQL/semantic/LLM)
    ↓
Guardrail checks (fraud, injection, hallucination)
    ↓
IF guardrail fails:
  → Mark conversation.needs_human_review = true
  → Store response (not sent to customer)
  → Alert ops (WhatsApp to shop owner)
  → Wait for human approval/rejection
  
ELSE (guardrail passes):
  → Check confidence gate (auto-approval if >85%)
  → Send response to customer
    ↓
Done
```

### What Stays the Same
- Confidence-based gating (already working well)
- Semantic FAQ search
- All LLM providers

### What Changes
- **Correction loop removed** (saves 2-3s latency)
- **Guardrail failures now escalate** (don't retry)
- **Conversation state locked** during HITL (prevents race conditions)
- **Cost cap enforced** (max 2 LLM calls per message)

---

## Consequences

### ✅ Benefits
1. **Latency SLA met:** P95 < 2s (from 5-8s)
   - Simple queries: <100ms
   - SQL queries: <150ms
   - LLM queries: 1500-2000ms (but with fast failover)

2. **Cost predictable:** 1 message = max 1 LLM call (with rare exceptions)
   - Savings: $5/day → $50-100/month
   - No runaway correction loops

3. **Network resilience:** Fewer API calls = fewer timeout risks
   - Each retry is a failure risk
   - Single-call-per-message = more reliable

4. **Human accountability:** Guardrail violations are explicit + auditable
   - Shop owner sees what failed + why
   - Logs show correction history

### ⚠️ Trade-offs
1. **Requires ops responsiveness:** HITL conversations need human review within 5-10 minutes
   - SLA violation if no ops on duty
   - Must set up escalation alerts

2. **Customer experience:** Fraud-flagged responses don't auto-correct
   - Customer sees "transaction flagged; contacting seller"
   - Need clear messaging (not frustrating)

3. **Implementation complexity:** Conversation locking is non-trivial
   - Race conditions are possible
   - Needs careful testing

---

## Implementation

### Phase 1: Guardrail Service (1 day)
- [ ] Create guardrail.service.js with RTO fraud, prompt injection, hallucination checks
- [ ] Integrate into message processing pipeline
- [ ] Add database: `conversations.needs_human_review` boolean

### Phase 2: Escalation Workflow (0.5 days)
- [ ] Create escalation_queue in database
- [ ] Update ai-chatbot.controller.js to check guardrails
- [ ] Alert ops when guardrail fails

### Phase 3: Conversation Lock (1.5 days)
- [ ] Implement Redis-based lock (conversation-level)
- [ ] Add lock acquire/release in processMessage
- [ ] Handle lock timeout (auto-release after 5min)

### Phase 4: Testing (1 day)
- [ ] Load test: 100 concurrent requests with guardrail checks
- [ ] Parallel message test: verify no race conditions
- [ ] Outage simulation: verify lock recovery

### Timeline: 4 days (Days 1-4 of Phase 4-A)

---

## Monitoring

### Metrics to Track
- Guardrail violations per day (by type)
- Escalation resolution time (SLA: <5 min)
- Hallucination detection accuracy (precision/recall)
- False positive rate (incorrectly flagged)

### Success Criteria
- P95 latency < 2s consistently
- No correction loop activations (logs should be empty)
- Guardrail violations auditable (all logged)
- Zero race conditions on HITL conversations

---

## Reversibility

**Reversibility: MEDIUM**

If this approach doesn't work (e.g., ops not responsive enough), we can:
1. Add selective AI retry with guardrail feedback (but only for specific failures)
2. Re-enable correction loop for specific intents (e.g., hallucination-sensitive queries)

To revert:
1. Remove guardrail escalation logic
2. Re-add correction loop in auto-approve service
3. Adjust confidence thresholds downward (accept more errors auto-corrected)

**Migration cost:** 2-3 days of rework

---

## Related Decisions

- **ADR-002:** Selective BullMQ Routing (complements this by reducing LLM call volume)
- **ADR-003:** SQLite Fallback Queue (handles network resilience if LLM call fails)

---

## Approval

- [ ] Tech Lead (CTO)
- [ ] Backend Lead
- [ ] QA Lead
- [ ] Ops Lead

