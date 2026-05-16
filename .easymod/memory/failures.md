# Failures & Incidents
**Last Updated:** —

## Overview
_Failure log maintained by EM-Orchestrator. Records production incidents, test failures, rollbacks, and root cause patterns to avoid repeating mistakes._

---

## Production Incidents

_No entries yet._

**Incident format:**
```md
## {YYYY-MM-DD} — {Incident Title}
**Severity:** P0 (outage) / P1 (degraded) / P2 (minor)
**Duration:** {start time → resolution time}
**Affected:** {modules, users, shops impacted}

### Root Cause
{What caused this?}

### Timeline
{Chronological events}

### Resolution
{What fixed it?}

### Prevention
{What should change to prevent recurrence?}
```

---

## Test Failures

_Recurring or notable test failures and how they were resolved._

_No entries yet._

---

## Rollbacks

_Features that were rolled back and why._

_No entries yet._

---

## Root Cause Patterns

_Patterns observed across multiple failures — helps predict future risk._

_No entries yet._

**Example patterns to watch for:**
- Race conditions in BullMQ job idempotency under retry bursts
- Redis connection drops during high-load queue processing
- Meta rate limit breaches during viral post comment spikes
- BKash OAuth token expiry not caught before payment call
- Sequelize N+1 query degradation on large order list queries
