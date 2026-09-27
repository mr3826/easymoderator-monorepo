# ADR-0008: Sales-Opportunity Follow-Up Is Manual, Through the Inbox

Status: Accepted
Date: 2026-09-27
Owners: Product + Engineering

## Context

An opportunity invites a follow-up message. The platform constraints are:

- Meta's 24-hour standard messaging window, outside which only narrow message
  tags are allowed, and none of them cover sales follow-up;
- the central policy engine (`policy.engine.js`) with opt-out, consent,
  window, template, rate-limit and business-hours rules;
- HITL and AI-pause state;
- the business reply mode;
- a recorded incident (2026-09-22) in which a single failing outbound send
  flipped a live Page's channel to `TOKEN_EXPIRED` and stopped inbound
  processing.

## Decision

The pilot sends **no automatic follow-up**.

- The opportunity shows the next step as advisory:
  - reply in the Inbox before the window closes;
  - wait for the customer;
  - do not contact (opted out);
  - contact by phone.
- **Open conversation** deep-links to `/inbox?conversation=<id>`. The merchant's
  reply there goes through the existing manual-send path and the central
  policy engine, with no new send path.
- Opted-out customers never produce an opportunity.
- A boundary test forbids the pilot modules from importing any Meta send,
  provider or webhook-send module.

## Alternatives rejected

- **Automatic templated follow-up.** It needs a new outbound path and a new
  consent model for promotional messages. It risks Meta policy violations
  outside 24 hours and channel disablement. It would also make the pilot's
  conversion metric depend on message deliverability rather than on detection
  quality.
- **Draft follow-ups queued for approval.** Useful later. For the pilot it adds
  another candidate lifecycle beside the Inbox draft lifecycle (ADR-0004).

## Consequences

- There is zero added messaging-policy risk. Conversion depends on merchant
  action, which the summary measures (`median_minutes_to_action`).
- Revisit after the pilot, with evidence of which reasons convert.
