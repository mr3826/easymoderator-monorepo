# 00 — Source and environment

Date: 2026-10-27 (Asia/Dhaka)

## Frozen source and rehearsal pin

| Item | Verified value |
|---|---|
| Original worktree | `D:\easymod\_wt-ic-merchant-workspace-v1` |
| Frozen code tip | `c164a0422046cd91313564817c00002e91d48463` |
| Frozen documentation tip | `d5dbd21620a0b25b6c57763c2214a95c811c2fbb` |
| Source relationship | Frozen code tip is an ancestor of the frozen documentation tip and of the rehearsal code commit |
| Rehearsal branch | `rehearsal/pilot-deployment-v1` |
| Rehearsal worktree | `D:\easymod\_rehearsal-pilot-deployment-v1` |
| Rehearsal code SHA | `6d6bc1dd056e09202b97d05e81f20308b15109ab` |
| Code commit parent | `6158b70d97425bc6a98de208059ed6c2085c84e4` |
| Git object/connectivity check | PASS; no integrity errors reported |

The frozen checkout had no tracked modifications. Its 84 pre-existing untracked Product Experience artifacts were preserved. The rehearsal branch was created from the documentation pin, not from a moving shared branch. The rehearsal worktree still contains unrelated untracked QA/cache and Product Experience artifacts; they were preserved and excluded from commits. `WORKTREE_CLEAN=NO` at handoff for those untracked items.

Application changes on the rehearsal branch:

- `3e7ce558fbb9cd445b5200c0b3eab9ce5f2b7148` — require a delivered (`SENT`) choice before numbered resolution; recheck the per-shop interaction flag and suppress the worker response when revoked.
- `714be0072b6c8a8bba181dbe814e284c3b342ffe` — synchronize the standalone frontend lockfile with declared `axe-core` dependencies.
- `6d6bc1dd056e09202b97d05e81f20308b15109ab` — make QueueManager imports passive, start consumers explicitly, await BullMQ worker readiness before advertising worker readiness, reuse the message Worker handle, and bind the Growth healthcheck to IPv4 loopback as Nginx expects.

The code commit was built and exercised in the rehearsal. A later local commit added the isolated runtime bootstrap scripts; no application source changed after `6d6bc1dd`. The final evidence commit edits this documentation package only, and its SHA is reported in the handoff response.

## Isolated runtime

| Item | Observed value |
|---|---|
| WSL distro | `EasyModPilotRehearsalV1` (dedicated WSL2 import) |
| Runtime and Docker data | `D:\easymod-runtime\pilot-deployment-rehearsal-v1` |
| Root filesystem | Ubuntu 24.04 WSL rootfs; official archive SHA-256 `2a790896740b14d637dbdc583cce1ba081ac53b9e9cdb46dc09a2f73abbd9934` |
| Docker Engine / Compose | 29.9.2 / 5.6.1 |
| Linux Node / npm | 20.20.2 / 10.8.2 |
| Compose project | `easymod-pilot-rehearsal-v1` |
| Compose network | Dedicated internal network; `Internal=true` |
| Rehearsal env | Ignored `.env.pilot-rehearsal`, synthetic/disabled provider placeholders only |
| Windows preview ports | 54580 and 54543 configured for `127.0.0.1`; host forwarding did not materialize |
| Final handoff state | All eight named-project containers gracefully stopped after receipts; named volumes and distro preserved |

The distro did not use Docker Desktop's engine. Docker Desktop, the default/other WSL distros, other containers, and owner services were not stopped or modified. All rehearsal database, queue, and app data is isolated in the named project and volumes. The throwaway webhook-test project used separate disposable data services and was removed with its own volumes after the tests.

The bootstrap scripts pin the verified Ubuntu archive hash, Docker Engine/Compose package versions, and official Node.js 20.20.2 archive hash. Supporting Ubuntu utility packages are installed from the signed Noble apt repository but are not version-pinned. The installer fails if the exact Docker package versions are unavailable from Docker's signed repository.

The Windows preview issue is observed, not inferred: Docker inspection showed the configured Caddy `HostConfig` bindings, but `.NetworkSettings.Ports` was null and `docker port` returned no mappings. Windows had no listener on 54580/54543; HTTP and HTTPS probes returned `000`. Internal HTTPS probes to Caddy succeeded. No firewall, global WSL, Docker Desktop, or host networking changes were made.

## Safety and credential boundary

The runtime received only synthetic provider placeholders. No real OpenAI/Gemini key was injected into the runtime, no provider API was called, no image or customer data was sent, and credentials were not printed or committed. The bootstrap preflight transiently compared the two requested Windows environment values against the ignored rehearsal env file to detect accidental injection; it did not log, persist, or pass those values to WSL. The proof JSON records this narrow read and the requested key-presence results without values. No production configuration, data, service, or flag changed. No push, shared-branch merge, or production deployment occurred. No other agent worktree or process was stopped.
