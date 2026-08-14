# Meta App Review — Package Currency Audit and Readiness

**Date:** 2026-07-28
**Scope:** every Meta-review document in the repo, checked against deployed code
and live production, plus the app-side changes needed so the submission is not
rejected for reasons within our control.

**Verdict: the package is now accurate and complete. Submission is blocked only
on four founder-owned items**, none of which are engineering work.

---

## 1. What was audited

| File | Was it current? |
|---|---|
| `docs/META_APP_REVIEW_MASTER_GUIDE.md` | Scope correct; index incomplete, nav path wrong |
| `docs/meta-app-review.md` | Scope correct; nav path wrong, no troubleshooting |
| `docs/meta-app-review-submission.md` | Scope correct; OAuth redirect URI left abstract, no icon/credentials/verification rows |
| `.easymod/meta-app-review/permissions-justification.md` | **Accurate** — matched the code exactly |
| `.easymod/meta-app-review/dashboard-setup-walkthrough.md` | Accurate; nav path wrong |
| `.easymod/meta-app-review/screencast-storyboards.md` | Existed, but covered 5 of the 12 required points and had no narration script |
| `.easymod/meta-app-review/test-user-credentials.md` | **Stale** — named a Page "to be created" that has since been superseded |
| `.easymod/meta-app-review/compliance-checklist.md` | **Two false PASS rows** (see §3) |
| `.easymod/meta-app-review/data-deletion-flow.md` | **Materially wrong** — described the pre-Phase-1 implementation |
| `.easymod/skills/meta-policy-skill.md` | **Dangerously stale** — listed Instagram and comment scopes as "Active" |
| Business verification / trade licence | **Did not exist anywhere** |

## 2. What was verified as correct and needed no change

The permissions story — the part a reviewer scores hardest — holds up.

- `DEFAULT_SCOPES` = `['pages_show_list', 'pages_messaging', 'pages_manage_metadata']`
  and `WEBHOOK_FIELDS` = `['messages']`
  (`MetaMessengerProvider.js:27-35`). Every submission document matches this
  exactly. No document claims a capability the code does not have.
- Graph API pinned at v22.0 in code and in the docs.
- Live on production 2026-07-28: `/privacy-policy` 200, `/terms` 200,
  `/api/webhooks/meta/data-deletion` 200 (GET) / 400 (POST, unsigned),
  `/api/webhooks/meta/deauthorize` 400 (POST, unsigned),
  `/channels/oauth-callback` 200.
- Webhook verification fails closed: wrong token 403, missing params 403,
  POST with a bad signature 403.
- The privacy policy page itself lists exactly the three permissions
  (`PrivacyPolicy.tsx:200-208`) and names Hexabyte Limited.
- App icon exists (`EasyMod-frontend/public/icon-1024.png`) — an earlier audit
  recorded it as missing.

### Correction to the 2026-07-26 audit

`docs/launch-readiness/2026-07-26/07_META_REVIEW_PACKAGE_AUDIT.md` states that
`.easymod/meta-app-review/` "does not exist" and raises F-08 (no screencast
storyboard) and F-09 (no test-user documentation). **The directory exists at
`EasyMod-backend/.easymod/meta-app-review/`** and contained six files including
both a storyboard and a test-user spec. That audit looked in the repo root.
F-08 and F-09 were real *gaps in content* — the storyboard was thin and the
credentials were placeholders — but not the *absences* they were recorded as.
The earlier report is left as-written since it is a dated artefact; this note is
the correction.

## 3. False claims found and corrected

These matter beyond tidiness: `compliance-checklist.md` and
`data-deletion-flow.md` are the documents a Data Protection Assessment gets
answered from. Quoting them as they stood would have been an inaccurate
attestation to Meta.

| Claim | Reality | Fixed in |
|---|---|---|
| "170 DMs/hour leaky bucket per pageId in `message-worker.js` Guard 5, Redis key `rate:meta:dm:{pageId}`" | No such key or guard exists. The current rule reads `meta:sends:{pageId}` and the provider records one event after each accepted Graph send. Atomic/concurrent enforcement and live Redis evidence remain unverified. | `compliance-checklist.md` policy check 6 |
| "`POST_PURCHASE_UPDATE` tag used for order confirmations outside window" | The current policy path sets `decision.augment.message_tag=POST_PURCHASE_UPDATE`, and the provider sends it on the wire. Live Meta acceptance/delivery remains unverified. | `compliance-checklist.md` policy check 7 |
| Deletion matches `channel_user_id = facebook_user_id` from the signed request | Meta sends an **app-scoped** ID; customers key on **page-scoped** PSIDs. Resolution now runs through `meta_user_identities`, and an unresolvable identity parks as `IDENTITY_NOT_RESOLVED` instead of reporting a fake success. | `data-deletion-flow.md` rewritten |
| Deletion cascades `orders` | Orders are **anonymised**, not deleted — accounting records are retained with every personal field scrubbed. | `data-deletion-flow.md` rewritten |
| Response is `{url: privacy-policy, confirmation_code: "DEL-{userId}-{ts}"}` | Response is a status URL plus an **opaque** code; the durable record stores only HMAC hashes, never the raw Meta ID. | `data-deletion-flow.md` rewritten |
| `meta-policy-skill.md`: `pages_read_engagement`, `pages_manage_engagement`, `instagram_basic`, `instagram_manage_messages` all "Active" | All four were removed in June. The skill is loaded first by `em-orchestrator` for any Meta work, so it was actively steering implementation out of scope. | `meta-policy-skill.md` |

## 4. App-side rejection risks — fixed this round

### 4.1 `appsecret_proof` missing on every Page-token call *(the real one)*

`subscribeWebhook`, `unsubscribeWebhook`, `verifyWebhookSubscription` and
`sendMessage` called the Graph API with `access_token` only, while every
user-token call in the same file signed with `appsecret_proof`.

Why this was a rejection vector: the App Dashboard has **"Require App Secret
Proof for Server API calls"**, and Meta prompts you to turn it on as a security
hardening step. Flip it, and all four of those calls start failing — which is
exactly the reviewer's path. The Page would connect with a dead webhook and the
reply would never send, on camera, with no error the reviewer could interpret as
anything other than a broken app.

Fixed: all four now sign. `appsecretProof()` returns `null` when the secret or
token is absent, and axios drops null params, so nothing throws in a
misconfigured environment. Regression tests assert the proof on send, subscribe
and verify.

### 4.2 The reviewer could not find the screen

Every document said "**Settings → Chat Settings**". The sidebar item is labelled
**"Chat"**, under a **SETTINGS** heading. A reviewer who cannot reach the
connect screen files "unable to test the functionality", which is a rejection.
All documents now say **Settings → Chat** and give the direct URL
`https://app.easymod.tech/manage-shop/chat-settings`.

### 4.3 Demo landmines now documented as intentional

Two behaviours look like defects on camera: Messenger **postbacks** are not
subscribed (a "Get Started" button produces silence), and **out-of-window**
transactional messages are deliberately dropped. Both are now in the storyboard's
"do not show" list, in the reviewer troubleshooting table, and in the Notes To
Reviewer text.

## 5. Package contents after this pass

| Document | Purpose |
|---|---|
| `docs/META_APP_REVIEW_MASTER_GUIDE.md` | Index and running order |
| `docs/meta-app-review.md` | Reviewer-facing guide + troubleshooting table |
| `docs/meta-app-review-submission.md` | Dashboard field values + permission text |
| `.easymod/meta-app-review/business-verification.md` | **New** — Bangladesh Trade Licence procedure, domain verification, DPA/Data Use Checkup/Tech Provider context |
| `.easymod/meta-app-review/screencast-storyboards.md` | **Rewritten** — 12 shots with word-for-word narration, coverage table, per-permission timestamps |
| `.easymod/meta-app-review/test-user-credentials.md` | **Rewritten** — the real verified assets |
| `.easymod/meta-app-review/compliance-checklist.md` | **Rewritten** — 12 gate rows + 12 policy checks with evidence, verified/carried-forward labelled |
| `.easymod/meta-app-review/data-deletion-flow.md` | **Rewritten** — matches the code |
| `.easymod/meta-app-review/permissions-justification.md` | Unchanged content; nav path and date corrected |
| `.easymod/meta-app-review/dashboard-setup-walkthrough.md` | Nav path and date corrected |

## 6. What still blocks submission — all founder-owned

| # | Blocker | Where |
|---|---|---|
| 1 | **Business Verification not started.** Longest lead time (2–10 business days). Advanced Access to `pages_messaging` will not go live for non-testers until it clears. | `business-verification.md` |
| 2 | **No tester customer account.** The screencast needs a second Facebook account that is *not* an admin of *Easy Style Fashion*, added to App Roles → Testers with the invite accepted. Without it the demo cannot show a customer messaging the Page. | `test-user-credentials.md` |
| 3 | **Screencast not recorded.** Unblocked by 2. Script is ready. | `screencast-storyboards.md` |
| 4 | **Dashboard configuration + Live-mode switch.** Icon upload, reviewer credentials in the dedicated fields, webhook verify-token self-check. | `compliance-checklist.md` item 5, submission sheet |

Also outstanding, and worth resolving before submitting: confirm whether
`Bornohin Fashion BD` — a `DISCONNECTED` Meta channel on production from earlier
testing — was ever a real merchant's Page. App Review asks about live business
assets, and the answer needs to be accurate.

## 7. Open engineering items — not review blockers

Recorded so they are not lost, and explicitly **not** fixed in this pass because
neither affects App Review:

1. **The Messenger send-rate limit still needs live/atomic proof.** `meta:sends:{pageId}`
   is recorded after accepted Graph sends, but concurrent reservation and live
   Redis behavior are not proven. Not something a reviewer exercises, but a
   live Page-restriction risk at volume.
2. **Out-of-window order/support follow-ups are tagged** with
   `POST_PURCHASE_UPDATE`; successful Meta acceptance/delivery is not yet live-
   verified and must not be presented as completed evidence.
