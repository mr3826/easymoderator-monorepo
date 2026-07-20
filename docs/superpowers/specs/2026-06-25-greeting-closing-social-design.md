# Greeting, Closing & Social Links — Design Spec

**Date:** 2026-06-25
**Branch:** `feat/greeting-closing-social-messages`
**Status:** Approved (design) → implementing → deploy to prod

## Goal

Let shop owners control three customer-facing touches, all wired into the live AI
reply pipeline, with sensible defaults provided out of the box:

1. **Greeting** — an auto-sent welcome on the first customer-visible AI reply of
   a conversation, carrying a fixed **Meta AI-disclosure** identifier the owner
   writes *around*.
2. **Closing** — a thank-you + "follow us" message appended to the order
   confirmation.
3. **Social media links** — shop profile links surfaced inside the closing.

## Decisions (locked with the founder)

- Greeting fires **automatically, once per conversation** (not per message).
- Closing fires **on order confirmation** (the `✅ Order placed` moment).
- **Single** greeting (no time-of-day variants).
- Edit location: greeting/closing on **Chat Settings**; social links on **Business Info**.
- Social platforms: Facebook, Instagram, WhatsApp, TikTok, YouTube, Website.
  (Instagram here is only a *profile link* — unrelated to the removed IG messaging
  integration.) WhatsApp accepts a `wa.me/...` link or a bare BD phone number.

## Data model (no DB migration — `Shop.settings` is already JSON)

```js
settings.ai.greeting = { enabled: true, custom_text: "<owner text>" }
settings.ai.closing  = { enabled: true, custom_text: "<owner text>" }
settings.businessInfo.socialLinks = {
  facebook: "", instagram: "", whatsapp: "", tiktok: "", youtube: "", website: ""
}
```

`sanitizeSettings` already preserves `ai` + `businessInfo`. New validators added for
the three blocks (string caps; social values must be http(s) URL or — for whatsapp —
a BD phone number; empty allowed). Greeting/closing ride the existing
`getShopAISettings`/`updateShopAISettings` endpoints; social links ride the existing
business-info endpoints. **No new routes.**

## The Meta AI-disclosure (static + owner text after it)

A code-level, language-aware constant (owner cannot remove, can write after it):

- bn: `হাই, আমি {shop}-এর AI সহকারী।`
- en: `Hi, I'm the AI assistant from {shop}.`
- mixed: `Hi, ami {shop}-er AI assistant.`

Sent greeting = **disclosure line + owner's `custom_text`**.

**Compliance floor stays intact:** the first customer-visible AI reply always starts
with this clear plain-text automated-assistant declaration, before any owner greeting,
FAQ answer, product answer, order-flow text, or LLM response. Held drafts do not
consume this disclosure because the customer never saw them. Legacy visible AI
replies that did not contain a disclosure also do not consume it; the next AI
reply will prepend the disclosure. The disclosure has no icon and no
owner-controlled off switch.

## Injection points (grounded in code)

**Greeting** — `jobs/message-worker.js`, before the AI response is stored/sent:
on the customer's first turn in the conversation, prepend `greetingPrefix + "\n\n"`
to `rawResponse`. Single send chokepoint → covers FAQ/product/LLM, fallback, and
order-flow replies uniformly.

**Closing** — `modules/order/order-session-standalone.service.js`, where the order is
created and `orderPrompt` (`✅ Order placed… + invoice`) is built (~line 702-722):
if `closing.enabled`, append `"\n\n" + closingBlock`. The closing block = owner's
`custom_text` + (only if any social link is set) a `Follow us:` list of the filled
links. Fires exactly once, at confirmation.

## Pure, testable core — `modules/shop/ai-messaging.js`

Dependency-free builders (the test weight lives here; the worker/order wiring is thin):

- `buildDisclosure(shopName, language)` → the static identifier line.
- `buildGreeting({ shopName, language, greeting })` → disclosure + custom_text, or
  `''` when disabled/blank-with-no-disclosure-needed.
- `renderSocialLinks(socialLinks, language)` → `Follow us:` block of only non-empty
  links, or `''` when none.
- `buildClosing({ closing, socialLinks, language, shopName })` → custom_text +
  social block, or `''` when disabled.

## Defaults (seeded for every shop via `shop-defaults.js`)

- greeting.custom_text (mixed default): `আসসালামু আলাইকুম! 👋 {shop}-এ স্বাগতম। কীভাবে সাহায্য করতে পারি?`
- closing.custom_text (default): `আমাদের সাথে কেনাকাটা করার জন্য ধন্যবাদ! 🛍️`
- both `enabled: true`; socialLinks all empty (closing renders thank-you only until
  the owner fills links).

## UI

- **Chat Settings** (`AISettingsForm.tsx`): "Greeting & Closing Messages" block — two
  toggles + two textareas; the static disclosure shown as a read-only preview chip
  above the greeting field so owners see exactly what customers receive.
- **Business Info** (`BusinessInfoForm.tsx`): "Social Media Links" block — six
  optional inputs.
- Types: extend `ShopAISettings` (greeting/closing) and the business-info type
  (socialLinks). i18n bn/en keys added.

## Existing dead fields — note, do not refactor

`brandingRules.greetingStyle` / `closingStyle` (Knowledge page) are stored but never
used in the prompt (`buildSystemPrompt` ignores them). This feature supersedes their
intent with real, wired messages. Left physically in place to avoid unrelated churn;
flagged here so the two are not later confused.

## Tests

- **BE (jest):** disclosure (bn/en/mixed + `{shop}` interpolation); greeting assembly
  (enabled/disabled/blank); social renderer (subset/empty/all); closing assembly;
  validators (accept/reject URLs + whatsapp phone + length caps).
- **FE (vitest + `npm run build`):** new fields render + save round-trip; social
  inputs persist; tsc passes (CI gate).

## Delivery

Feature branch → PR → CI green → **merge to `main` (auto-deploys to droplet)** →
verify `/health/ready` 200 and the new settings render in prod. No migration = low
deploy risk. Append a deploy + compliance section to
`docs/launch/CLEVEL_FINAL_AUDIT_2026-06-24.md`.

## Non-goals / risks

- No time-of-day greetings; no per-language owner text (single free-text field each).
- Not removing the dead `greetingStyle`/`closingStyle` fields.
- Closing depends on the deterministic order step-machine firing; conversational
  "thanks/bye" does not trigger it (by design — confirmed with founder).
