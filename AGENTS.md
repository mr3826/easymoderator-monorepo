## Growth OS

For every Growth OS task:

1. Read `docs/growth-os/README.md` and `docs/growth-os/EXECUTION_STATE.md`.
2. Inspect current repository evidence before trusting historical plans.
3. Reuse existing authentication, permissions, merchant records, audit, and
   database conventions.
4. Execute exactly one Growth OS phase per task unless explicitly instructed
   otherwise.
5. Enforce authorization on the server; frontend checks are UX only.
6. Keep Growth OS internal-only and modular within EasyModerator.
7. Do not use `audit_logs` as the prospect source of truth.
8. Update `docs/growth-os/EXECUTION_STATE.md` with validation receipts before
   finishing.
9. Do not begin the next phase automatically.

Phase 3 prospect work uses the two-table ledger described in
`docs/growth-os/04-prospect-foundation.md`. Merchant signup and Partner form
producers remain unchanged; the one-off importer is dry-run by default.
