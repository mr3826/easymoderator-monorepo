# EasyModerator Pilot Deployment Rehearsal V1

**Disposition: PARTIAL. Production release: NO-GO pending owner authorization.**

This package records the work performed against the frozen integrated candidate, the narrow fixes made on an isolated branch, the checks that passed, and the runtime gates blocked by the local Docker storage failure. It does not certify a deployment, migration, backup restore, alert path, or production release.

Provider review also corrected the customer-photo data-flow description: the default-on photo extraction path uses the shared Gemini-to-OpenAI fallback chain. No image was sent during this rehearsal. Keep `AI_PHOTO_MATCH_ENABLED=false` for a live pilot until both providers' image-data terms and the owner's data-transfer approval are confirmed.

Independent cost review found that the July AI cost audit's “no vision” estimate is stale against the pinned source and conflicts with the August photo-cost assumptions. A conditional image-token estimate exists, but effective models, billing tier, fallback mix, and cost per valid task are unknown. Keep AI reply mode at `MANUAL`: provider-outage events are not consumed by the Inbox SSE hook, and provider failure can fall through to a keyword path that treats Bangla/Banglish price words as order intent. D-1 now recommends deferring live traffic until gates and measurable stop criteria are in place, then considering one opted-in shadow/manual shop for workflow learning only.

## Review order

1. 00-source-and-environment.md — source pins, isolation, host constraints.
2. 01-deployment-parity.md — production topology and rehearsal differences.
3. 02-deployment-rehearsal.md — build, configuration, and runtime evidence.
4. 03-feature-flags-and-side-effects.md — flag defaults and the interaction delivery fix.
5. 04-migration-and-recovery.md — database, worker, rollback, and recovery gates.
6. 05-owner-decisions-d1-d7.md — one consolidated founder decision package.
7. 06-ai-provider-inventory.md — current contracts and workload map.
8. 07-openai-api-evaluation.md and 08-gemini-api-evaluation.md — official API suitability.
9. 09-provider-cost-privacy-decision.md — cost, privacy, and final provider recommendation.
10. 10-independent-attestation.md — reviewer coverage and unclosed gates.
11. 11-founder-go-no-go.md — final handoff.

The machine-readable summary is rehearsal-proof.json. The execution history and skill register are in 12-execution-plan-and-skill-register.md.

## Rehearsal configuration

The committed local-only Compose overlay is docker-compose.rehearsal.override.yml with Caddyfile.rehearsal. It reuses docker-compose.prod.yml service topology, but builds local images, binds only 127.0.0.1 ports 54580/54543, uses a project-isolated network marked internal, supplies synthetic local values through ignored .env.pilot-rehearsal and .env.pilot-images files, explicitly disables image paths for backend, and supplies the same false image flags to worker through the ignored rehearsal env file. Neither service was started; these are config inputs, not runtime observations.

The Compose configuration parser passed:

    docker compose --env-file .env.pilot-rehearsal --env-file .env.pilot-images -f docker-compose.prod.yml -f docs/pilot-deployment-rehearsal-v1/docker-compose.rehearsal.override.yml --project-name easymod-pilot-rehearsal-v1 config --quiet

No rehearsal image was verified by digest and no rehearsal service was started. The local Docker metadata store returned snapshot I/O errors and a read-only filesystem; the system drive also had zero free space. Do not interpret the overlay or parser result as a running preview.

## Resuming runtime work

Have the host owner recover C: space through a reviewed, non-destructive path. Preserve Docker/WSL processes and the unidentified WSL-relayed listener on port 6379; do not prune or restart them to clear this rehearsal. After space is restored, confirm Docker health read-only, review the synthetic env inputs and this overlay, rebuild all local app images from the recorded source SHA, record immutable digests, and run the missing migration, flag, recovery, monitoring, shutdown, and restart gates in the isolated project. Keep external egress blocked and do not load real provider credentials or customer data. A successful config --quiet is only a manifest check.
