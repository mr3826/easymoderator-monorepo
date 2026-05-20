# Screencast Storyboards

**App:** Easy Moderator
**Last updated:** 2026-05-20

These are text scripts for two required Meta App Review screencasts. The founder records the actual video using these as a shot-by-shot guide. Each step maps to a visible UI action.

---

## Storyboard 1: Comment-to-DM Auto-Reply

**Goal:** Demonstrate that Easy Moderator only sends a DM when a user comments with the configured keyword on the merchant's own post. Shows the full end-to-end flow from connection through inbox logging.

**Duration estimate:** 2–3 minutes

### Step 1 — Merchant connects Facebook Page

- Screen: Easy Moderator dashboard, Channels page (`/channels`)
- Action: Click "Connect Facebook Page"
- What happens: OAuth popup opens to `facebook.com/dialog/oauth`. Merchant grants `pages_messaging`, `pages_read_engagement`, `pages_manage_posts`.
- What to show: OAuth consent screen listing the permissions. After approval, the page returns to Channels and the connected Page name and profile picture appear.

### Step 2 — Merchant enables auto-reply on a post

- Screen: Channels page, "Comment Auto-Reply" tab
- Action: Toggle "Enable comment auto-reply" ON. Set trigger keyword to "interested". Optionally enable "Reply publicly to comment".
- What to show: The keyword field, the toggle state, the save confirmation toast.

### Step 3 — Customer comments on a Facebook post

- Screen: Switch to Facebook (test Page visible in the browser)
- Action: As the test customer account, comment "I'm interested in the blue dress" on a product post on the merchant's Page.
- What to show: The comment appearing on the post.

### Step 4 — Easy Moderator detects the keyword and sends a DM

- Screen: Back to Easy Moderator — Unified Inbox (`/app/inbox`)
- What to show: Within a few seconds, a new conversation thread appears in the inbox from the test customer. The AI-generated Messenger DM is visible as a sent message (e.g. "Hi! Thanks for your interest. Here are the details for the blue dress...").

### Step 5 — Customer replies in Messenger

- Screen: Facebook Messenger (test customer account)
- Action: The test customer sends a reply: "What sizes are available?"
- What to show: The reply arriving in the Easy Moderator inbox in real time.

### Step 6 — Conversation is logged in inbox

- Screen: Easy Moderator Unified Inbox
- What to show: The full conversation thread — the outbound DM (sent by Easy Moderator) and the customer's inbound reply. The conversation metadata panel shows the customer name, platform (Messenger), and timestamp.

---

## Storyboard 2: Opt-Out Respected End-to-End

**Goal:** Demonstrate that when a customer sends "STOP", Easy Moderator records the opt-out and the policy engine prevents any further outbound messages to that customer — even if a merchant manually tries to send.

**Duration estimate:** 2–3 minutes

### Step 1 — Customer sends opt-out keyword

- Screen: Facebook Messenger (test customer account)
- Action: Test customer sends the message "STOP" to the merchant's Page.
- What to show: The message appearing in Messenger.

### Step 2 — Opt-out is logged in the inbox

- Screen: Easy Moderator Unified Inbox
- What to show: The "STOP" message appears in the conversation thread. The conversation is flagged — a badge or label shows "Opted out" or the thread is marked with a status change (e.g. "Messaging paused").

### Step 3 — Opt-out is recorded in the customer profile

- Screen: Easy Moderator customer detail panel (click the customer's name in the inbox thread)
- What to show: The customer profile shows `messaging_consent.facebook.opted_out_at` populated (or an equivalent "Opted out" status indicator). This confirms the consent event was written.

### Step 4 — Merchant attempts to send a follow-up message

- Screen: Easy Moderator Unified Inbox, same conversation thread
- Action: Merchant types a message in the composer and clicks Send.
- What happens: The send is blocked. The composer shows an inline error: "Cannot send — this customer has opted out of messages." (the policy engine deny with a user-readable reason, not a stack trace).
- What to show: The error state in the composer. The message is NOT sent to Messenger.

### Step 5 — Policy decision is visible in admin view

- Screen: Easy Moderator — navigate to the customer's conversation audit trail or policy decisions log (accessible via the conversation detail panel's "Audit" tab or equivalent admin view).
- What to show: A policy_decision row showing `outcome: BLOCKED`, `reason: messenger_opted_out`, `customer_id`, and `created_at`. This confirms the policy engine wrote an audit row.

### Step 6 — Opt-out persists across sessions

- Screen: Reload Easy Moderator and navigate back to the same conversation.
- What to show: The opt-out status is still present. The composer is still disabled for this customer. The opt-out survives a page refresh (it is persisted in the database, not browser state).

---

## Notes for Recording

- Use a test Facebook Page and a second personal account as the test customer — do not use real customer data in the review video.
- Credentials for the test accounts are in 1Password under "Meta App Review Test Accounts" — see [test-user-credentials.md](test-user-credentials.md).
- Record at 1080p minimum. Show the full browser including the URL bar so the reviewer can see the domain.
- Narrate each step out loud or add text captions.
