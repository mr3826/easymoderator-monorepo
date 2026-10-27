# Gate C/D local evidence procedure

This procedure is for one disposable, synthetic rehearsal project. It is not a
production backup, restore, rollback, alert, or RPO/RTO attestation. Keep the
prior rehearsal and sibling worktrees untouched. Use only the new closure
Compose project, with synthetic fixture data and the internal Docker network.

## Gate C — backup, restore, rollback, and queue recovery

### Entry conditions

- Use [`compose.yml`](compose.yml) from the repository root with the exact
  project name `easymod-operational-gate-closure-v1` and an absolute path to a
  generated, external env file containing only `CLOSURE_*` variables (including
  separate `CLOSURE_RESTORE_DB_USER` and `CLOSURE_RESTORE_DB_PASSWORD`). It maps
  only those allowlisted values into the app, binds the backend API to
  `127.0.0.1:54643`, and gives every service a single internal network. Its
  named volumes carry the same project prefix. The file does not run migrations
  and does not include a volume-deleting cleanup command.
- Confirm every database, Redis, vector-store, app, and helper container belongs
  to that project before sending any synthetic request.
- Keep the Compose network internal. Do not attach any service to another
  network. Publish only the preview ports required by the authenticated
  browser flow, bound to Windows loopback.
- `NODE_ENV=production` is intentional: it preserves the candidate's Secure
  cookie flags and exercises production config validation. The browser must use
  the separate loopback HTTPS preview. The local runtime still differs from
  production in its synthetic data, fake/blank provider credentials, internal
  no-egress network, local alert sink, loopback-only API, and isolated volumes;
  it is candidate-image evidence, not production acceptance.
- Use synthetic shops, users, customers, products, conversations, and orders.
  Do not load or copy a production or merchant backup.
- Put generated local passwords and signing keys in one ignored, mode-0600
  temporary env file. Do not print it or include it in an artifact. Keep real
  model-provider, Meta, payment, courier, email, Sentry, and Slack credentials
  absent.
- Use a URL-safe synthetic database password (hex is suitable) because the
  Compose file builds `DATABASE_URL` from the separately supplied synthetic DB
  fields. The model keys mapped into the app are fixed invalid test markers;
  network egress remains disabled by the internal-only network. The production
  config validator requires a nonempty provider key, so the application may
  attempt provider requests; they cannot leave this network. Its config may
  report the test marker as present, which is not evidence that a provider is
  reachable or that the live key is configured.
- Save only sanitized counts, hashes, timings, image IDs, and test results under
  the run evidence directory. Never save database dumps, SQL row contents,
  cookies, bearer tokens, environment output, or browser storage state there.

### Backup and isolated restore

1. Seed the disposable database with the same two synthetic shops used by the
   authenticated E2E. Record the expected counts for the core entities and the
   synthetic business records before taking the backup.
2. Use the disposable PostgreSQL service to produce a custom-format dump inside
   the container. Copy that dump into the ignored run directory without
   printing its contents. Record its byte length and SHA-256.
3. Verify it with `pg_restore --list --exit-on-error`. Do not treat a successful
   `pg_dump` exit code alone as integrity evidence.
4. Restore the dump into the Compose `postgres-restore` service, which has its
   own project-scoped volume and the fixed database name
   `easymod_restore_closure_v1`. Keep `CLOSURE_DB_NAME` distinct from that
   restore name. Use `pg_restore
   --clean --if-exists --exit-on-error --no-owner --no-privileges` only against
   this named restore target; those flags can delete objects in the target. The
   restore service has no published port and shares only the internal network.
5. Compare sanitized row counts, the latest migration ledger entry, foreign-key
   orphan counts for the fixture's declared relationships, and the expected
   synthetic order/conversation state. Record counts and pass/fail only; do not
   print customer rows.
6. Record elapsed backup and restore time as **synthetic local timings**. These
   do not establish production RPO/RTO or prove the production backup schedule.

The repository's `backup.yml` restore drill is protected, main-only, and SSHes
to the production host. Do not dispatch it for this local gate. The backend
`backup-database.js` restore path has a useful `RECOVERY_TARGET=isolated` guard
and requires a separate `RECOVERY_DATABASE_URL`, but it still runs `pg_restore
--clean --if-exists`; use only a disposable target. The workflow's local dump
integrity checks can inform the method, but its production receipt is not local
evidence.

### Previous-image compatibility

1. Identify the previous application image by immutable digest from a trusted
   local receipt or current deployment record. Do not use a mutable tag as the
   rollback identity.
2. Confirm the candidate's migration state against a clone of the synthetic
   database. Preserve a pre-migration clone, then apply candidate migrations to
   a separate clone using the exact candidate image and its deployment startup
   flags.
3. Start the previous immutable backend image against the candidate-migrated
   clone with migrations disabled and all external egress unavailable. Check
   readiness, synthetic merchant authentication, and read-only access to the
   fixture records. Then stop it and re-check the database for unintended
   writes.
4. Report PASS only if the exact previous image starts and serves the migrated
   schema. If that digest is unavailable, a local source rebuild is useful
   compatibility information but does not prove rollback of the deployed image;
   mark the deployed-image check BLOCKED and request the prior digest/image
   provenance from the release owner.

Do not run `scripts/rollback-rehearsal.sh` directly on the Windows host or in
the shared rehearsal distro. It owns `/opt/easymod` and removes files there
during cleanup. That script's CI run verifies rollback orchestration and
synthetic image/config references; it does not by itself prove that the actual
previous application image supports the candidate schema.

### Worker and queue recovery

Use the authenticated synthetic browser flow to create a durable inbound
message/receipt. Keep all outbound integrations pointed at local test doubles
or unavailable. The internal network must prevent internet egress, so accidental
provider calls fail locally rather than reaching Meta, model, payment, courier,
email, Slack, or Sentry endpoints.

1. Stop only the worker service in the closure Compose project.
2. Submit one signed synthetic webhook through the local ingress. Confirm its
   durable receipt and that the job is waiting while the worker is stopped.
3. Record `waiting`, `active`, `completed`, `failed`, and DLQ counts before and
   after the worker restart. Restart only the closure worker.
4. Follow the job to a terminal state and reconcile its inbound receipt,
   conversation state, audit event, and delivery record. A transport failure
   must remain visibly failed/undelivered; it must not be reported as sent.
5. Confirm commerce mutation flags remain disabled and no order, courier, or
   payment side effect occurred. Resolve the synthetic conversation through
   the authenticated handoff flow and verify that recovery did not replay a
   customer send or bind the job to the other shop.

Capture only synthetic IDs and aggregate queue counts. This local check proves
the stopped/restarted worker path exercised in this run, not production Redis
durability, persistence across host loss, or duplicate-effect safety for every
external adapter.

## Gate D — PII-free alert receipt and recovery

### Local receiver

`scripts/operational-gate-closure-v1/local-pii-free-alert-sink.js` accepts the
Slack-compatible `POST /webhook`, returns HTTP 200 with `ok`, and retains only
an in-memory receipt containing the timestamp, byte count, and SHA-256 of the
body. It never logs or persists alert text. Run it as a service attached only
to the closure Compose network, with `ALERT_SINK_HOST=0.0.0.0`, and do not add a
host port mapping. Configure the synthetic application with
`SLACK_ALERT_WEBHOOK_URL=http://alert-sink:8081/webhook` and leave
`SENTRY_DSN` unset. Check `GET /healthz` and retrieve `GET /receipt` from a
container on that internal network. Export the JSON receipt, not the alert body.

For an isolated human-readable alert self-test, the authenticated super-admin
route is `POST /api/admin/ops/test-alert`. Its controller records
`admin:ops_test_alert` before dispatch. The test alert contains no customer
data, and reports `slackAccepted`; the local receipt is still required to prove
delivery to the configured sink. The local sink's receipt does not prove that a
human received an alert on a real device.

### Synthetic incident chain

Follow [`alert-recovery-rehearsal.md`](alert-recovery-rehearsal.md) and use its
guarded `alert-recovery-harness.js` commands. The harness posts a synthetic
signed `optin` event while the Page is disconnected, confirms the PII-free
local alert receipt, creates one null-token synthetic channel, and runs the
existing receipt reconciler once while the dedicated worker remains stopped.
It verifies the `PROCESSED` receipt and consent audit without creating a
message job, running inference, calling Meta, or changing commerce state.

`opsAlert` logs its `detail` locally and sends it to Sentry and Slack when those
sinks are configured. Keep Sentry absent and Slack pointed only at the local
sink. Before using a failure path, inspect its detail/context fields and confirm
they contain only synthetic IDs and a bounded error code; do not use raw
provider errors or message text as incident evidence. The existing failed-job
alert path includes `err.message` in detail/context, so do not feed it arbitrary
untrusted text. A local receipt proves HTTP acceptance by the test sink, not
production alert routing or on-call receipt.

### Owner-controlled items that remain after local evidence

- The production backup owner must provide the approved backup destination,
  retention, and recovery objective, then run the protected restore drill with
  its required environment approval. Local synthetic RPO/RTO timings are not a
  substitute.
- The release owner must provide the prior immutable image digest and provenance
  if it is unavailable locally. A source rebuild cannot stand in for that
  deployed-image rollback check.
- The on-call/operations owner must name and authorize the production alert
  destination and human receipt check. Do not point this local rehearsal at a
  real Slack webhook or Sentry DSN.
- Production credentials/data, protected workflows, and any production-side
  restore, alert, or deployment action remain outside this local gate.

## Recorded backup and restore evidence (2026-10-27)

The isolated synthetic backup is `D:\easymod\_operational-gate-closure-v1-local\closure-backup.dump` (314,461 bytes; SHA-256 `759e4a0b99481d3a7b852e80e2862a42766d8c839b0dab6989991b6468ce9dad`). `pg_restore --list` produced 693 TOC entries. The backup was restored into a separate closure restore database.

The sanitized comparison receipt reports 80 source and restore tables, 181 source and restore rows, matching core counts (2 shops, 8 customers, 7 conversations, 11 messages, 1 order, and 66 migration rows), and 146 foreign keys on each side with zero unvalidated constraints and no table-count mismatches. The source and restored synthetic shop counts are 2 each.

The current receipt does not yet contain the representative order-field comparison requested by the procedure. Treat that subcheck as pending until a sanitized equality receipt is recorded. The exact previously deployed application image digest is unavailable, so rollback compatibility with the deployed image remains **BLOCKED**; a locally rebuilt base-source image is not a substitute.