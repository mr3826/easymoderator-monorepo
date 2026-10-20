# Final QA Machine Artifacts

- `gates.json` contains the final scoped gate results, run identifiers, and explicit `NOT_RUN` boundaries.
- `SHA256SUMS.txt` lists SHA-256 digests with paths relative to the worktree root. It covers this report set, its machine-readable gates, and the supplied `../customer-simulator.csv` input. The checksum list omits itself.

The report records one preserved P2 integration-runner diagnostics limitation. A successful independent retry passed the selected integration subset. This package does not authorize integration rollout, production release, push, merge, or deployment.
