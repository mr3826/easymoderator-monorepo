# 00 — Source and environment

Date: 2026-10-27 (Asia/Dhaka)

## Frozen source

| Item | Verified value |
|---|---|
| Original worktree | D:\easymod\_wt-ic-merchant-workspace-v1 |
| Frozen code tip | c164a0422046cd91313564817c00002e91d48463 |
| Frozen documentation tip | d5dbd21620a0b25b6c57763c2214a95c811c2fbb |
| Source relationship | c164a042 is an ancestor of d5dbd216 |
| Documentation-only pin | The d5dbd216 delta changes the pilot readiness document and its proof JSON only |
| Rehearsal branch base | d5dbd216 |
| Rehearsal branch | rehearsal/pilot-deployment-v1 |
| Rehearsal worktree | D:\easymod\_rehearsal-pilot-deployment-v1 |
| Rehearsal code SHA | 714be0072b6c8a8bba181dbe814e284c3b342ffe |

The frozen checkout had no tracked modifications. It contained 84 pre-existing untracked Product Experience artifacts; their names and contents were preserved in place. Git object connectivity verification exited 0 with no integrity errors. No push or shared-branch merge occurred.

The readiness report at d5dbd216 includes a stale statement that the candidate stays at d79332fd. The verified source pins are c164a042 for code and d5dbd216 for the documentation pin. This discrepancy is recorded rather than silently treated as a matching SHA.

## Rehearsal source changes

The isolated branch contains two source commits after the frozen documentation tip:

- 3e7ce558fbb9cd445b5200c0b3eab9ce5f2b7148 — require a delivered interaction choice before a typed-number reply can resolve it; recheck the per-shop interaction flag at resolution and suppress the worker fallback/send if it was revoked.
- 714be0072b6c8a8bba181dbe814e284c3b342ffe — synchronize the standalone frontend lockfile with package.json. The production Docker build context is EasyMod-frontend, and the child lockfile had omitted @axe-core/playwright and axe-core.

The first change is a small policy-boundary correction supported by focused service/worker tests and independent code review. The second follows a reproduced standalone npm ci failure; a standalone lockfile dry-run passed after the correction. The package lock change does not update application behavior.

## Host and service inventory

At the start of the rehearsal, existing Postgres/Redis containers and the original Vite process were inventoried and left running. Rehearsal ports 54580 and 54543 were selected for loopback-only binding. No other worktree or owner process was stopped or changed.

During the later build attempt, Docker reported snapshot I/O errors and a read-only containerd metadata database. The only container stopped was this task's temporary Node 20 lockfile diagnostic container; Docker could not remove its dead metadata because the store was read-only. Existing services were left as found. The C: volume reported 0 bytes free; D: had ample capacity. On a follow-up check, docker context inspect showed the default endpoint as npipe:////./pipe/docker_engine and desktop-linux as npipe:////./pipe/dockerDesktopLinuxEngine. A read-only docker --context default info probe produced no output for 30 seconds and was interrupted; it did not start or stop a service. No podman, nerdctl, postgres, or redis-server executable is available in PATH. A fresh reviewer thread could not be created because the Codex thread store reported insufficient disk space. No user files were deleted to recover space.

The rehearsal environment used synthetic database/authentication/provider placeholders only. Credential values were not printed or committed. No real provider key was injected into Compose, no provider API was called, and no merchant or customer data was used.

Latest read-only host inventory: C: remained at 0 bytes free and D: had 125,862,297,600 bytes free. Docker Desktop processes were present and its `docker-desktop` WSL distro was running, but `docker --context desktop-linux version` returned no output for 60 seconds and was interrupted. A listener was present on loopback port 5173 under the existing `node.exe` in `D:\easymod\_local-runtimes`; listeners on 6379 were associated with `com.docker.backend.exe` and `wslrelay.exe`. The Linux service/container behind 6379 could not be identified. A later full host Jest attempt still tried `::1:6379` and `127.0.0.1:6379` through BullMQ despite blank Redis variables; both attempts returned `ECONNREFUSED`, and the run was interrupted before totals. No successful TCP connection is evidenced. The latest host inventory found no listener on 5432; ports 55432 and 56379 from the initial inventory were not rechecked. These listeners were left untouched; they are not rehearsal services or evidence of an available isolated database/Redis target.
