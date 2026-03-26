# 📌 PHASE 4 STANDUP CARD — Daily Sync Reference

**Print this. Use it every morning standup.**

---

## 🎯 THIS WEEK'S GOAL
**Get from 5-8s latency → <2s latency**
**Reduce cost $300/mo → $50-100/mo**
**Live pilot with 1 shop by Friday EOD**

---

## 📅 CRITICAL PATH (7 Days)

```
Day 1 (Today):
  ✅ INDEX PRODUCTS        [Backend Dev]    — Ready to deploy
  🔄 LATENCY FAILOVER       [Lead Dev]       — BLOCKING Day 2

Day 2:
  🔄 COST CAP              [Backend Dev]    — Dependent on Day 1
  🚀 GUARDRAILS            [Lead Dev]       — Parallel

Day 3:
  ✅ ESCALATION RUNBOOK    [Tech Lead]
  🔄 OPS TRAINING          [Tech Lead]
  
Day 4:
  🔄 CONVERSATION LOCK     [Lead Dev]       — Parallel
  🧪 PILOT TEST            [Tech Lead]      — 1 shop, 5 escalations

Day 5:
  🔄 INTENT ROUTER         [Backend Dev]    — Final critical item
  🔍 LOAD TESTING          [All]            — P95 < 2s gate

Days 6-7:
  📖 Code review + merge
  📊 Performance validation
  🚀 READY FOR PRODUCTION
```

---

## 🧠 CRITICAL SUCCESS FACTORS

| Factor | Target | WIN | FAIL |
|--------|--------|-----|------|
| Latency (P95) | <2s | Go live | Rollback |
| Cost/msg | <$0.005 | Go live | Fix queries |
| Guardrail False Positives | <5% | Go live | Tune thresholds |
| Ops SLA (5min) | 100% met | Go live | More training |

---

## 📝 DAILY STANDUP (5MIN FORMAT)

**Each person:**
1. "Yesterday I [completed/blocked]..."
2. "Today I [will do]..."
3. "Blocker? Risk?"

**Order:** Backend → Lead Dev → Tech Lead → Ops

**Leads if stuck:**
- "Need code review from $PERSON?"
- "Is migration blocking me?"
- "Can we parallelize?"
- "Do we need a sub-agent?"

---

## 🔧 QUICK COMMANDS

```bash
# Deploy latest migration
npm run db:migrate:dev

# Load test (P95 latency)
npm run test:load:latency -- --concurrency 100 --seconds 60

# Cost audit (messages/cost)
npm run test:load:cost -- --messages 1000 --shops 5

# Check logs for issues
npm run logs:tail -- ERROR,WARN | head -20

# Run all tests
npm run test:all

# Check guardrail triggers
npm run test:guardrails -- --verbose
```

---

## 📂 FILES CHECKLIST

```
✅ IMPLEMENTATION_SPEC_PHASE4.md
✅ IMPLEMENTATION_TRACKER.md (standup section)
✅ ADR-001-Remove-Correction-Loop.md
✅ src/database/migrations/20260326_001_add_product_indexes.js
✅ src/modules/ai/guardrail.service.js

⏳ src/modules/ai/llm.service.js [UPDATE: Timeout logic]
⏳ src/database/migrations/20260326_002_add_metadata_costcap.js
⏳ src/modules/ai/auto-approve.service.js [UPDATE: Cost cap check]
⏳ src/modules/conversation/conversation-state.service.js [NEW: Locking]
⏳ src/modules/ai/intent-router.service.js [UPDATE: Route order]
⏳ docs/ESCALATION_RUNBOOK.md
```

---

## ⚠️ BLOCKERS TO WATCH

**Red Flags:**
- ❌ Index migration fails → Don't proceed to Day 2
- ❌ Latency still >3s after failover → Debug provider timeout
- ❌ Cost cap not enforced → Revert and investigate
- ❌ Guardrail false positive >10% → Tune thresholds
- ❌ Ops can't complete runbook → More training needed

**Recovery:**
- Blocker → Tech Lead decides: fix or de-scope
- De-scope non-critical (Tasks 8-14 can wait)
- Never ship broken critical path

---

## 🎯 SUCCESS METRICS (DAILY)

Track at 5pm:

```
Day 1:
  - Index queries: <100ms? Y/N
  - Tests pass? Y/N

Day 2:
  - P95 latency: __ seconds (target <2s)
  - Cost per message: $__ (target <0.005)
  - Failover triggers: __ times (target: >5 in test)

Day 3:
  - Guardrail false positives: __% (target <5%)
  - Ops completed runbook? Y/N

Day 4:
  - Pilot: 5 escalations completed? Y/N
  - Ops SLA met (5min)? Y/N

Day 5:
  - All critical tests pass? Y/N
  - Ready for production? Y/N
```

---

## 🚀 GO-LIVE CHECKLIST (EOD Friday)

```
Code:
  ☐ All 7 tasks coded + merged
  ☐ All tests passing (unit + integration + load)
  ☐ Code reviewed + approved

Performance:
  ☐ P95 latency <2s (verified in load test)
  ☐ Cost per message <$0.005
  ☐ Cache hit rate >40%

Operations:
  ☐ Ops trained + passed runbook test
  ☐ Pilot shop escalations 100% resolved <5min
  ☐ Monitoring alerts configured
  ☐ Rollback procedure documented

Docs:
  ☐ All ADRs updated
  ☐ Runbook complete + linked
  ☐ Training slides archived

---

**If all ☐, deploy to production Monday**
**If any ☐ blank, fix before Monday**
```

---

**Questions? Ask Tech Lead or check `IMPLEMENTATION_SPEC_PHASE4.md`**

