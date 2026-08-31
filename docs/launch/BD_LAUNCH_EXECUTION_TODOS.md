# BD Launch Execution TODOs

Last updated: 2026-08-28

Scope: private/founder-led Bangladesh launch for EasyModerator as a Facebook Messenger DM-only product. The commercial model is implemented; live bKash enablement remains gated by the payment checklist below.

## Meta App Review Workstream

Status: not submitted yet.

Submit App Review only for:

- `pages_show_list`
- `pages_messaging`
- `pages_manage_metadata`

Reviewer positioning:

- Describe EasyModerator as a Facebook Page Messenger inbox with AI-assisted replies for BD f-commerce sellers.
- Demonstrate direct customer Messenger DM only.
- Do not mention comments, Instagram, WhatsApp, omnichannel automation, comment-to-DM, or public comment replies in review materials.
- Use a tester Page and tester customer account while the app remains in Development mode.
- Screencast path: sign in, open Chat Settings, connect Facebook Page, receive inbound Messenger DM, show AI draft/manual reply, show explicit enablement before auto-reply.

Dashboard setup to verify before submission:

- OAuth redirect URL matches production `META_OAUTH_REDIRECT_URI`.
- Webhook callback URL is `https://api.easymod.tech/webhooks/meta`.
- Webhook subscription is `messages` on the `page` object only.
- Data deletion callback is configured.
- Deauthorize callback is configured.
- App mode, business verification, app icon, privacy policy URL, and terms URL are complete.

## BD Trust And Legal Copy

Launch copy must position the product as:

> Bangla-first Facebook Messenger AI sales assistant for BD f-commerce sellers, with COD/RTO risk support.

Do not publish claims unless evidence exists:

- "Meta-approved" before App Review approval is granted.
- "Bangladesh's #1".
- Fake or unverified shop counts, testimonials, revenue claims, or automation claims.
- Omnichannel, Instagram, WhatsApp, or comment-to-DM support.

RTO Shield public language must cover:

- What data is used.
- Why it is used.
- Merchant responsibility for notice, lawful basis, and consent where required.
- Customer correction, dispute, and deletion process.
- Retention period or retention principle.

Founder/counsel approval required before public launch for final Privacy Policy and Terms language.

## Founder-Led Client Hunt CRM

Minimum lead fields:

- Lead source.
- Niche.
- Facebook Page URL.
- Estimated order volume.
- Current pain or trigger.
- Status.
- Next action.
- Owner.
- Objection.
- Activation stage.

Recommended activation stages:

- Researched.
- Contacted.
- Demo booked.
- Signup completed.
- Facebook Page connected.
- Business profile completed.
- Knowledge added.
- Assistant test passed.
- First inbound DM received.
- First AI draft/reply sent.
- Pilot active day 7.

Automation boundaries:

- Send signup leads and partner-form leads into the CRM.
- Use funnel events to update activation stage where possible.
- Generate internal founder reminders for day 1, 3, 7, and 12 follow-ups.
- Allow human-approved outbound messages only.
- Do not automate cold Meta DMs.
- Do not scrape private Meta data or customer conversations for prospecting.

## Instrumentation Events

The funnel event endpoint should track:

- `landing_view`
- `signup_started`
- `signup_completed`
- `facebook_connect_started`
- `facebook_connect_succeeded`
- `shop_profile_completed`
- `first_product_added`
- `assistant_test_passed`
- `first_inbound_message`
- `first_ai_reply_sent`
- `first_order_captured`
- `first_rto_flag`
- `plan_assigned_shuru`
- `usage_threshold_70`
- `usage_threshold_90`
- `usage_threshold_100`
- `plan_upgraded`
- `topup_purchased`
- `renewal_succeeded`
- `renewal_failed`
- `partner_applied`
- `partner_approved`

Before paid growth, confirm these events are visible in production audit/analytics exports and mapped to CRM activation stages.

## Commercial And Payment TODOs

Shuru is free forever with 100 conversations/month. Growth is ৳999/month with
500 conversations/month and `PACK_100`, `PACK_300`, and `PACK_700` top-ups.
Partner has no monthly fee and uses flat delivered-order bands. Conversation
exhaustion pauses only AI replies; it never creates an overage charge.

- TODO: Mount and verify bKash order webhook route.
- TODO: Keep bKash disabled until payment-ID binding, minor-unit amount checks, and replay tests pass in staging.
- TODO: Run one live bKash production money test for a Growth top-up and a recurring invoice.
- TODO: Verify renewal, `PACK_*` top-up, failed payment, duplicate callback, amount mismatch, and refund/no-refund paths.
- TODO: Reconcile payment webhook docs and production env variables; set `VITE_BKASH_ENABLED` only after backend verification.

## Manual Launch QA

Run this with a real Facebook Page tester before private launch:

1. Confirm a first-time shop starts on active Shuru with 100 conversations/month.
2. Connect a Facebook Page through Meta OAuth.
3. Send an inbound Messenger DM.
4. Confirm AI suggestion appears as a draft.
5. Confirm auto-reply stays off until explicitly enabled.
6. Send opt-out text in English, Bangla, and Banglish; confirm future outbound sends are blocked.
7. Run `launch-readiness.js` once production admin token is available.
