# App Review Readiness Checklist

**App:** EasyModerator
**Last updated:** 2026-07-28 (re-verified against deployed code and production)

Statuses below distinguish **re-verified 2026-07-28** from **carried forward**
(asserted in an earlier pass, not re-checked this round). Do not quote a
carried-forward row to Meta as though it were freshly proven.

---

## Submission gate

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Privacy Policy live at `/privacy-policy` | **PASS** (re-verified 2026-07-28) | `https://easymod.tech/privacy-policy` → 200, renders without auth. Names Hexabyte Technologies (linked to hexabyte.tech) and lists exactly the three permissions (`PrivacyPolicy.tsx:200-208`). |
| 2 | Terms of Service live at `/terms` | **PASS** (re-verified 2026-07-28) | `https://easymod.tech/terms` → 200. **The URL is `/terms`, not `/terms-of-service`** — the latter 404s. |
| 3 | Data Deletion Callback live | **PASS** (re-verified 2026-07-28) | `POST /webhooks/meta/data-deletion` → 400 `{"error":"Missing signed_request"}` without a signed request; `GET` → 200 with human-readable instructions. Fails closed on a bad HMAC (403). App-scoped→page-scoped ID resolution goes through `MetaUserIdentity` (`meta-compliance.service.js:454-471`) — the 2026-07-22 finding M1 ("deletes nothing") is **resolved**. |
| 4 | Deauthorize callback live | **PASS** (re-verified 2026-07-28) | `POST /webhooks/meta/deauthorize` → 400 without a signed request, 403 on bad HMAC. `GET` returns 404 by design — the route is POST-only, which is all Meta calls. |
| 5 | Webhook verification (`hub.challenge`) | **PASS, with one founder step** | Negative paths proven on production 2026-07-28: wrong token → 403, missing params → 403, `POST` with a bad signature → 403. Timing-safe compare at `meta-webhook.routes.js:79-88`. `META_WEBHOOK_VERIFY_TOKEN` is in `CORE_REQUIRED` **and** `LONG_SECRETS` in `production-config.validator.js:17,51`, so the deploy could not have succeeded with it unset or placeholder — it is set to a real value in production. **The positive challenge cannot be proven without the token value.** See "Founder self-check" below. |
| 6 | Permission justifications written | **PASS** (re-verified 2026-07-28) | `permissions-justification.md` — three permissions, each with use case, screen, Graph call and retention. Matches `DEFAULT_SCOPES` in `MetaMessengerProvider.js:27-31` exactly. |
| 7 | App icon available | **PASS** (new, 2026-07-28) | `EasyMod-frontend/public/icon-1024.png` (1024×1024) and `icon-512.png`. Previously flagged absent by finding F-10; the asset exists, it just had not been recorded here. Still needs uploading in the App Dashboard. |
| 8 | Reviewer credentials + test assets | **PARTIAL** | Tester account, test Page and merchant account exist and were exercised on production 2026-07-27. **The tester *customer* account does not exist yet** and blocks the screencast — see `test-user-credentials.md`. |
| 9 | Screencast recorded | **PENDING** | Storyboard and word-for-word narration ready in `screencast-storyboards.md` (12-point coverage table). Recording is founder-owned and blocked on item 8. |
| 10 | No test/sandbox data in production screenshots | **PENDING** | Production carries no seeded test data; the QA account was purged 2026-07-27. Depends on the recording being made with the accounts in `test-user-credentials.md`. |
| 11 | App mode is LIVE (not Development) | **PENDING — founder** | Verify in the App Dashboard. Keep it in Development until the screencast is recorded (Dev mode restricts webhooks to app-role accounts, which is what makes tester recording predictable), then switch to Live. |
| 12 | Business Verification completed | **DONE (2026-08)** | Verified in the Meta Business Manager. Procedure retained in `business-verification.md` for the record. No longer a blocker. |

### Founder self-check for item 5

Once you have entered the token in the App Dashboard, confirm the handshake from
any shell — substitute the value you pasted. Do not paste the token into a
ticket, a chat, or this repo.

```bash
read -rs -p "verify token: " T && echo
curl -s "https://api.easymod.tech/webhooks/meta?hub.mode=subscribe&hub.verify_token=$T&hub.challenge=easymod_probe_12345"
unset T
```

Expected output is exactly `easymod_probe_12345`. Anything else — empty, or a
403 — means the dashboard value and `META_WEBHOOK_VERIFY_TOKEN` differ, and
"Verify and Save" will fail.

---

## Policy engine checks

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| 1 | User-initiated trigger | PASS (carried forward) | Replies are sent only in response to inbound Messenger messages. Comment-to-DM is neither mounted nor subscribed. |
| 2 | No cold outreach | PASS (carried forward) | No broadcast feature; all sends are reactive. |
| 3 | No fake engagement | PASS (carried forward) | No auto-like, auto-follow or auto-share anywhere in the codebase. |
| 4 | Consent recorded | PASS (carried forward) | `consentService.recordInbound()` on every inbound event. |
| 5 | Opt-out honoured | PASS (carried forward) | `policy.engine.js` checks `messaging_consent.{platform}.opted_out_at` before every outbound. |
| 6 | Send rate limited | **PARTIAL — code path present; live/atomic proof pending** | `rateLimit.rule.js` reads `meta:sends:{pageId}` with `zcard`, and `MetaMessengerProvider` records one event after each accepted Graph send. Redis failure is fail-closed at the policy gate. Atomic reservation under concurrent workers and live Redis evidence remain unverified. |
| 7 | 24-hour window enforced | **PARTIAL — tag path present; live Meta proof pending** | The 24-hour window guard attaches `POST_PURCHASE_UPDATE` for default order/support follow-ups and `MetaMessengerProvider` puts it on the Send API request. Do not claim successful out-of-window delivery until a real connected Page is verified. |
| 8 | Content appropriate | PASS (carried forward) | Guardrail service, hallucination detector and quality-score gate on all AI replies. |
| 9 | Page ownership | PASS (re-verified 2026-07-28) | Pages are intersected against `debug_token` granular target IDs, so only Pages the merchant selected in Facebook are connectable (`MetaMessengerProvider.js:71-83`). |
| 10 | Deduplication | PASS (carried forward) | `external_id` storage guard plus a Redis NX idempotency guard prevent duplicate replies. |
| 11 | Automated-experience disclosure | PASS (re-verified 2026-07-28) | Every conversation's first AI reply is prepended with an owner-uneditable clear-text disclosure, in en/bn/mixed (`ai-messaging.js:21-50`). No toggle removes it. **Show this in the screencast** — Meta requires users to know they are talking to an automated system. |
| 12 | `appsecret_proof` on every Graph call | **PASS — fixed 2026-07-28** | Previously the four Page-token calls (send, subscribe, verify, unsubscribe) omitted the proof while every user-token call sent it. With "Require App Secret Proof for Server API calls" enabled in the Dashboard, that would have broken the reviewer's connect and reply on camera. All calls now sign; regression tests assert it on send, subscribe and verify. |

---

## Remaining actions before submission

**Founder:**

1. ~~Complete **Meta Business Verification**~~ — done, verified 2026-08.
2. Create the **tester customer account** and accept its App Roles → Testers invite — `test-user-credentials.md`.
3. **Record the screencast** — `screencast-storyboards.md`.
4. Enter reviewer credentials in the App Dashboard fields.
5. Upload `icon-1024.png` as the app icon.
6. Run the item-5 webhook self-check after configuring the Dashboard.
7. Switch the app to **Live mode** after recording.
8. Confirm whether `Bornohin Fashion BD` was ever a real merchant Page.

**Engineering (not review blockers):**

9. `MetaMessengerProvider` records `meta:sends:{pageId}` after each accepted Graph send; atomic/concurrent enforcement and live Redis evidence remain unverified (policy check 6).
10. The default out-of-window path sets `decision.augment.message_tag=POST_PURCHASE_UPDATE`; live Meta acceptance/delivery is not established by repository tests.
