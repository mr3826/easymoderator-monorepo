# Local Integration Results

## Historical passing receipt

`artifacts/integration/e4008ad7-468b-4a4f-9e09-fdd55a7494a1.json` reports `PASS`:

- 12 selected PostgreSQL/Redis integration tests passed.
- 46 webhook-pipeline tests passed.
- Disposable project-scoped PostgreSQL 16 and Redis 7, temporary storage, loopback-only published ports, bridge IP masquerading disabled, and project-scoped teardown.
- External providers disabled and zero blocked non-loopback attempts.
- Compose cleanup completed successfully.

The receipt's `sourceRevision` is `78b6250af40039749f9c096cd3e0debe2e6cf6a7`, while the committed V1.2 candidate is `dd04c079f2b752725d372e879cb1549a8459b8d1`. The receipt proves a real isolated local-stack pass but does not pin the test result to the final committed candidate.

## Current-candidate refresh

The refresh attempt stopped before Compose startup. Docker network inspection failed; Docker Desktop's service remained stopped and the local daemon API returned HTTP 500 for its info/network-list endpoints. No integration test started and this attempt created no containers. `LOCAL_INTEGRATION_PASS=NOT_RUN` for the exact committed candidate. This status is separate from the historical passing receipt above.

## Boundaries

No Meta, payment, courier, production, or staging endpoint was used. A fresh passing current-candidate receipt and live Meta verification are required before claiming integration readiness.
