# Final QA Machine Artifacts

- `gates.json` contains the final scoped gate results, evidence IDs, test counts, and explicit `NOT_RUN` boundaries.
- `privacy-scan.json` records the final recursive scan counts and the dataset SHA-256; it does not contain source-row values.
- The privacy scan and checksum manifest can be regenerated from `EasyMod-backend` with `python scripts/product-experience/scan-artifact-privacy.py`; it writes aggregate counts and file hashes only.
- `SHA256SUMS.txt` lists SHA-256 digests with paths relative to the worktree root. It covers the complete V1.1 report and evidence package plus the supplied `../customer-simulator.csv` input. The checksum list omits itself.

The independent package review passed with 0 P0 / 0 P1 / 0 open P2 findings in scope. The final privacy scan covers 285 JSON artifacts and four Playwright ZIP archives with no parse errors, denied keys, or exact source text matches. The 363-entry SHA-256 manifest was verified against every path and digest. A previous integration attempt did not preserve its suite-level failure diagnostics; the final integration run passed and the current runner writes structured failure summaries. This package does not authorize integration rollout, production release, push, merge, or deployment.
