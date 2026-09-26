-- Read-only production audit and session evidence for a mobile proof window
-- (docs/deployment/MOBILE_API_ACTIVATION_RUNBOOK.md). Counts only: no user, shop,
-- IP or token column is selected. Run with psql -v start='<ISO timestamp>'.
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

\echo native audit events (action, source, count)
SELECT action, COALESCE(metadata->>'source', '(none)') AS source, count(*)
FROM audit_logs
WHERE created_at >= :'start' AND action LIKE 'NATIVE%'
GROUP BY 1, 2
ORDER BY 1, 2;

\echo native sessions created since start
SELECT count(*) FROM user_sessions WHERE created_at >= :'start';

\echo native sessions ended since start (reason, count)
SELECT COALESCE(metadata->>'deactivated_reason', '(unspecified)') AS reason, count(*)
FROM user_sessions
WHERE updated_at >= :'start' AND is_active = false
GROUP BY 1
ORDER BY 1;

ROLLBACK;
