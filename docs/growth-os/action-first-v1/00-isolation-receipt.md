# Isolation Receipt — Action-First V1 execution start

- UTC timestamp: 2026-10-20T03:11Z
- Canonical repo: `D:\easymod\easy-moderator` (origin `https://github.com/mr3826/easymoderator-monorepo.git`)
- `git ls-remote origin refs/heads/main` = `07168f49066e4dc4a8e2a756621ac577a13c12bd`
- `git fetch origin main` then `git rev-parse origin/main` = `07168f49066e4dc4a8e2a756621ac577a13c12bd` (match)
- Feature branch: `feat/growth-os-action-first-v1-20261020T0310Z` created from `origin/main`, pushed with `-u` (remote ref confirmed = `07168f49`)
- Worktree: `D:\easymod\_wt-growth-os-action-first-v1` (new, previously unused path)
- PR created: NO. Merge: NO. Deploy: NO.

## Pre-existing worktrees (NOT touched)
Main checkout on `fix/meta-all-pages-granular-authorization` (uncommitted addendum doc — belongs to another agent).
Other registered worktrees: `_tmp/product-experience-v1-baseline` (detached 07168f49), `_wt-easymoderator-v6-auth-landing`, `_wt-merchant-journey-v6-action-first`, `_wt-merchant-workflow-v5-implementation`, `_wt-merchant-workflow-v5-ux-responsive`, `_wt-merchant-workspace-redesign-v1`, `_wt-mobile-app`, `_wt-mobile-execution`, `_wt-orders-execution-workspace-v2`, `_wt-pilot-customer-rto`, `_wt-public-funnel-landing-auth-v1`, `_wt-v4-bold-future-facing`, `_wt-v5-landing-recovery`, `_wt-v5-ux-responsive-remediation`, `backup-restore-helper-fix`, `easymoderator-product-engine-v1`.

## Pre-existing Docker resources (NOT touched)
Running Compose projects: `easymod-v4-local` (loopback :4283), `easymod-v5-local` (:4284), `easymod-v6-local` (:4285), `reals-factory`, `yt-automation`.
Listening loopback ports at start: 3456, 4283, 4284, 4285, 18080 (others system). Our review stack will bind ONLY auto-selected free loopback ports outside these ranges; dedicated Compose project name `em-growth-review-<runid>`; dedicated volumes/networks; never `docker system prune`, never down -v on foreign projects.

## Concurrency notes
No other registered worktree is on Growth OS branches; several agents work on merchant funnel (v4/v5/v6) and mobile. Our file ownership is scoped to `EasyMod-growth/`, `EasyMod-backend/src/modules/growth-os/`, growth E2E scripts, `docs/growth-os/action-first-v1/`, and new review compose under its own directory.
