# Gate D — synthetic alert and receipt replay

This local-only rehearsal sends one synthetic signed `optin` event through the
real `/api/webhooks/meta` handler, observes the local PII-free alert receipt,
then replays the held receipt through the production reconciler class. It does
not contact Meta, an AI provider, email, or a customer. It does not send a
message or create a queue job.

## Preconditions

- Use only Compose project `easymod-operational-gate-closure-v1` and database
  `easymod_ops_gate_e2e` (`CLOSURE_DB_NAME=easymod_ops_gate_e2e`); use the
  generated external `CLOSURE_*` env file and never print or source its
  contents into terminal output.
- The primary authenticated E2E seed has created exactly the closure tenant and
  shops `OGCE2E-A` / `OGCE2E-B`; Shop B must remain in effective `MANUAL` mode.
- Start/keep the candidate API and its declared dependencies healthy in the
  closure project. The API must reach the local alert sink at
  `http://alert-sink:8081/webhook`; that sink has no published host port.
- Stop only the closure `worker` service and verify it is exited before posting.
  This rehearsal directly invokes the existing receipt reconciler once, so the
  scheduled worker must stay stopped to avoid a concurrent claim or unrelated
  scheduled job. The helper requires an explicit stopped-worker confirmation;
  it cannot query Docker service state itself.
- Confirm the Compose network remains the sole `internal: true` network, all
  credentials are synthetic markers, `SENTRY_DSN` and external alert sinks are
  absent, and the provider/commerce feature flags remain disabled. The helper
  independently rejects a wrong project confirmation, database host/name,
  real provider-marker values, external alert destination, or enabled side
  effect flag.
- Use a fresh run ID. Keep the terminal out of shell tracing (`set -x`) because
  Docker Compose receives the external env file path.

## Exact command path

Run from the WSL worktree root. Set `CLOSURE_ENV_FILE` to the already-generated
external closure env file; do not print its contents.

```sh
dc() {
  docker compose --project-name easymod-operational-gate-closure-v1 \
    --env-file "$CLOSURE_ENV_FILE" \
    -f docs/operational-gate-closure-v1/compose.yml "$@"
}

CONFIRM=(-e OPS_E2E_PROJECT_CONFIRM=easymod-operational-gate-closure-v1 \
         -e OPS_E2E_SEED_CONFIRM=SEED_LOCAL_OPS_E2E_ONLY)
STOPPED=(-e OPS_E2E_PROJECT_CONFIRM=easymod-operational-gate-closure-v1 \
         -e OPS_E2E_SEED_CONFIRM=SEED_LOCAL_OPS_E2E_ONLY \
         -e OPS_E2E_WORKER_STOPPED_CONFIRM=WORKER_STOPPED_FOR_ALERT_REHEARSAL)

# Read-only checks: verifies the target DB/shops, provider markers and local sink.
dc exec -T "${CONFIRM[@]}" backend \
  node scripts/operational-gate-closure-v1/alert-recovery-harness.js preflight

# Stop only this project's worker and verify it is exited. Do not stop the API.
dc stop worker
dc ps -a worker

RUN_ID="alert-$(date -u +%Y%m%dT%H%M%SZ)-$$"

# Sign the synthetic opt-in in memory and POST it to the API container's loopback.
dc exec -T "${STOPPED[@]}" backend \
  node scripts/operational-gate-closure-v1/alert-recovery-harness.js post "$RUN_ID"

# Require one IDENTITY_NOT_RESOLVED receipt, retained encrypted replay bytes,
# and exactly one new local sink receipt containing only receipt metadata/hash.
dc exec -T "${STOPPED[@]}" backend \
  node scripts/operational-gate-closure-v1/alert-recovery-harness.js inspect-held "$RUN_ID"

# Create the null-token synthetic CONNECTED Page row and make only this receipt due.
dc exec -T "${STOPPED[@]}" backend \
  node scripts/operational-gate-closure-v1/alert-recovery-harness.js prepare-replay "$RUN_ID"

# Run the real WebhookReceiptReconcilerJob once; it refuses other due/aged receipts.
dc exec -T "${STOPPED[@]}" backend \
  node scripts/operational-gate-closure-v1/alert-recovery-harness.js reconcile "$RUN_ID"

# Confirm PROCESSED state, one synthetic consent audit row, no queue job, and no
# additional alert receipt. Then disconnect only this helper-created Page row.
dc exec -T "${STOPPED[@]}" backend \
  node scripts/operational-gate-closure-v1/alert-recovery-harness.js inspect-recovered "$RUN_ID"
dc exec -T "${STOPPED[@]}" backend \
  node scripts/operational-gate-closure-v1/alert-recovery-harness.js cleanup "$RUN_ID"
```

The helper validates the database is exactly `postgres/easymod_ops_gate_e2e`,
the seed confirmation is present, the Shop B tenant/name matches the closure
seed, `NODE_ENV=production` and Secure-cookie configuration remain intact, the
local Slack sink is the only alert destination, and provider/commerce flags
remain off. The event contains only generated synthetic Page/sender IDs and an
artificial opt-in reference. It never writes or prints the webhook body,
signature, provider keys, tokens, or customer row content.

## Expected evidence and limits

- `post` returns HTTP 200 and exactly one durable `IDENTITY_NOT_RESOLVED`
  `optin` receipt with `PAGE_NOT_CONNECTED`; its payload hash matches the
  submitted synthetic event, while its encrypted body is never displayed.
- The local sink receipt count increases by one. The returned receipt contains
  only sequence, timestamp, byte length, and SHA-256. No alert body is stored.
- `prepare-replay` creates one `CONNECTED` Facebook channel row for the
  synthetic Shop B/Page pair with no token ciphertext, then marks only that
  receipt due.
- `reconcile` claims and processes exactly that one receipt, writes one
  `OPT_IN_EXPLICIT` consent audit row for the synthetic fixture, clears the
  encrypted replay body, and reports one recovery attempt/success. The helper
  refuses to run if another receipt is due or if any receipt is old enough for
  the reconciler's retention sweep to remove.
- `inspect-recovered` confirms the receipt is `PROCESSED`, no queue job was
  created, the local alert count is unchanged, and the channel has no token.
  `cleanup` disconnects only the exact helper-created Page and detaches its
  synthetic customer link; it retains the terminal receipt and consent audit.

This proves a signed local webhook, PII-free alert-sink HTTP acceptance, and
synthetic receipt replay through the reconciler's opt-in branch. It does not
prove a human received a production alert, customer-message queue recovery,
provider delivery, or production egress/RPO/RTO behavior. Preserve the local
database and inspect sanitized state if any command fails; do not reuse the run
ID or run `docker compose down --volumes`.
