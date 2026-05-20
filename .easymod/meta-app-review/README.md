# Easy Moderator — Meta App Review Overview

**Last updated:** 2026-05-20
**Prepared by:** Hexabyte Limited (work.evan.ahmed@gmail.com)

---

## What Easy Moderator Does

Easy Moderator is a SaaS AI-commerce automation platform built for Bangladeshi f-commerce (Facebook commerce) merchants. It enables small and medium businesses to:

1. **Automate comment-to-DM replies** — when a customer comments on a product post using a configured keyword (e.g. "interested"), Easy Moderator sends a Messenger DM to that customer with product details or a purchase prompt.
2. **Manage a unified AI inbox** — all inbound Facebook Messenger and Instagram Direct Messages from customers are routed into an AI-assisted inbox where the AI can reply, or a human agent can take over (HITL — Human in the Loop).
3. **Process orders via conversation** — customers can place, confirm, and track orders through Messenger and Instagram DM conversations.
4. **Respect opt-out and consent** — a policy engine checks every outbound message against the 24-hour Messenger window, customer opt-out status, and rate limits before sending.

## Who Uses It

Target users are Bangladeshi f-commerce sellers who run product stores primarily through Facebook Pages. Typical shop: 1–5 admins, 50–500 customer conversations per month, selling apparel, accessories, or electronics via Facebook posts and Messenger.

## Channels Supported

- **Facebook Messenger** (primary)
- **Instagram Direct Messages** (secondary)

WhatsApp is not supported. The platform is scoped to Meta messaging only.

## Meta Permissions Requested

| Permission                  | Required For                                         |
|-----------------------------|------------------------------------------------------|
| `pages_messaging`           | Send/receive Messenger DMs on behalf of the Page     |
| `pages_read_engagement`     | Read comments on posts for keyword trigger detection |
| `pages_manage_posts`        | Reply to comments (not just DMs)                     |
| `instagram_basic`           | Access IG Business account for comment monitoring    |
| `instagram_manage_messages` | Send/receive Instagram Direct Messages               |

Full per-permission justification: see [permissions-justification.md](permissions-justification.md).

## App Review Artifact Index

| File                                                        | Purpose                                                |
|-------------------------------------------------------------|--------------------------------------------------------|
| [permissions-justification.md](permissions-justification.md) | Per-permission use case, API call, data retention      |
| [screencast-storyboards.md](screencast-storyboards.md)       | Step-by-step scripts for two required review videos    |
| [test-user-credentials.md](test-user-credentials.md)         | Reviewer test account spec (no live credentials here)  |
| [compliance-checklist.md](compliance-checklist.md)           | App Review Readiness Checklist with pass/fail evidence |
| [data-deletion-flow.md](data-deletion-flow.md)               | GDPR data-deletion cascade diagram and prose           |

## Privacy Policy and Terms

- Privacy Policy: `https://www.easymod.tech/privacy-policy`
- Terms of Service: `https://www.easymod.tech/terms`
- Data Deletion Callback: `POST https://api.easymod.tech/webhooks/meta/data-deletion`
