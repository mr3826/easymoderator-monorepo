# BD Launch Execution TODOs

Last updated: 2026-07-01

Scope: private/founder-led Bangladesh launch for EasyModerator as a Facebook Messenger DM-only product. Payment work is intentionally deferred and tracked below as TODOs.

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
- Webhook callback URL is `https://easymod.tech/api/webhooks/meta`.
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
- `trial_day_7_active`

Before paid growth, confirm these events are visible in production audit/analytics exports and mapped to CRM activation stages.

## Payment TODOs

Payment work is not active scope for this execution plan.

- TODO: Mount and verify bKash order webhook route.
- TODO: Run live bKash production money test.
- TODO: Verify subscription renewal, top-up, failed payment, refund/no-refund paths.
- TODO: Reconcile payment webhook docs and production env variables.

## Manual Launch QA

Run this with a real Facebook Page tester before private launch:

1. Confirm a first-time shop starts in Draft mode.
2. Connect a Facebook Page through Meta OAuth.
3. Send an inbound Messenger DM.
4. Confirm AI suggestion appears as a draft.
5. Confirm auto-reply stays off until explicitly enabled.
6. Send opt-out text in English, Bangla, and Banglish; confirm future outbound sends are blocked.
7. Run `launch-readiness.js` once production admin token is available.
