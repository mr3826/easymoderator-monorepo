# Redis operations

## The eviction policy is not negotiable

```
maxmemory-policy = noeviction
```

Set in `docker-compose.prod.yml` on the `redis` service command line. BullMQ warns
on every worker boot if it is anything else.

**Why.** This Redis backs BullMQ, and `maxmemory-policy` is **server-wide** even
though the queues are isolated in their own logical database. Under `allkeys-lru`
a burst of session writes in db0 can evict a job key in db3, and the job
disappears with no error raised anywhere — a customer message that is simply
never replied to, with nothing in the DLQ to show for it.

The failure modes trade like this:

| policy | behaviour at `maxmemory` |
| --- | --- |
| `allkeys-lru` | evicts silently — queued work vanishes, no error, no DLQ entry |
| `noeviction` | **writes fail loudly** — the caller sees an error and can retry |

Failing writes is recoverable. Losing queued work is not.

## Why noeviction is safe here

Measured in production before the switch:

| | |
| --- | --- |
| `used_memory` | 14.26 MB |
| `used_memory_peak` | 16.23 MB |
| `maxmemory` | 256 MB |
| headroom | ~94% |
| `evicted_keys` | **0** — the LRU policy had never once been needed |

Growth is bounded on every key class:

| db | keys | contents | bound |
| --- | --- | --- | --- |
| 0 | ~21.8k | `sess:` Express sessions | **every key has a TTL** (`keys == expires`) |
| 1 | ~11 | `msg:` / `shop:` / `canary:` cache | TTL |
| 2 | ~1 | `rl:` rate limit | TTL |
| 3 | ~575 | **all `bull:*` queues** + `sse:` | `removeOnComplete` / `removeOnFail` counts |

BullMQ retention is capped in code: `removeOnComplete: { count: 100 }` and
`removeOnFail: { count: 500 }` on `message-processing` (`src/jobs/message-queue.js`),
100/200 and 50/100 on the cron queues (`src/jobs/queue-manager.js`). Raising those
counts raises the memory floor — check headroom before you do.

## Monitoring implication

`noeviction` converts a silent-data-loss risk into an availability risk, so the
ceiling has to be visible before it is reached. `GET /health/detailed`
(authenticated) reports:

```json
"redis_memory": {
  "usedBytes": …, "maxBytes": …, "peakBytes": …,
  "policy": "noeviction",
  "usedPercent": 5.6
}
```

Unknown values are reported as `null`, never as `0` — a fabricated "0% used"
reads as a healthy, nearly-empty instance when the truth is that the ceiling is
unknown.

**Watch `usedPercent` and `policy`.** If `usedPercent` trends toward 100, either
raise `maxmemory` (the droplet has room) or shorten session TTLs — do not
"fix" it by reverting to an evicting policy, which trades a visible outage for
invisible job loss. If `policy` ever reads anything but `noeviction`, the compose
file has drifted or a container was started outside compose.

## Applying a change

`maxmemory-policy` lives in the service `command:`, so the container must be
**recreated**, not restarted — `docker compose restart redis` will not pick it up.
The deploy's `docker compose up -d` step recreates it when the command changes.
The `redis_data` volume with `--appendonly yes` preserves sessions and queued jobs
across the recreate.

A live instance can be changed without a restart via `CONFIG SET maxmemory-policy
noeviction`, but that is ephemeral: there is no `redis.conf` here, so a restart
reverts to the compose command line. Use it only to close a window immediately —
the compose file is the source of truth.
