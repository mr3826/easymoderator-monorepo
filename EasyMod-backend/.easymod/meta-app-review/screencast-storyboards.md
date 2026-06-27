# Meta App Review Screencast Storyboards

**App:** Easy Moderator
**Last updated:** 2026-06-27 (Messenger-only launch; Comment-to-DM removed)

## Storyboard 1: Messenger DM Inbox And AI Reply

**Goal:** Demonstrate the initial launch flow: connect a Facebook Page, receive a direct Messenger DM, send an AI reply, and send a manual reply.

**Duration:** 2-3 minutes.

### Step 1 - Connect Facebook Page

- Screen: Easy Moderator -> **Settings -> Chat Settings**
- Action: Click **Connect Facebook Page**.
- Show: Facebook Login for Business requests only `pages_show_list`, `pages_messaging`, and `pages_manage_metadata`.
- Show: Page picker after consent.
- Show: Connected channel card with webhook active status.

### Step 2 - Customer Sends Direct DM

- Screen: Facebook Messenger using the tester customer account.
- Action: Send a direct message to the connected test Page.
- Show: The message is a private Messenger DM, not a Page post comment.

### Step 3 - Shared Inbox Receives Message

- Screen: Easy Moderator -> **Shared Inbox**.
- Show: The direct DM appears in the thread list and message view.

### Step 4 - AI Reply

- Screen: Same inbox thread.
- Show: AI reply is delivered through Messenger.
- Show: The required automated-assistant disclosure in the first AI reply.

### Step 5 - Manual Reply

- Screen: Same inbox thread.
- Action: Type and send a manual reply.
- Show: Reply is delivered to the customer in Messenger.

## Do Not Show

Do not show or narrate:

- Comment-to-DM
- Page post comment triggers
- `feed` webhook events
- Public replies to comments
- Private replies to comments
- Live selling from comments

Those features are removed from the initial launch and are not part of Meta App Review.

## Development Mode Note

If the app is still in Development mode, send the inbound DM from the supplied customer account that is listed under App Roles -> Testers.
