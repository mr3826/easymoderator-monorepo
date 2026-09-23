# Meta Messaging Production Proof Evidence

Date: 2026-09-22
Production SHA: `2b1ad61ac654c246fe0d36337bba36cbd633b403`
Page permissions: `pages_show_list`, `pages_messaging`, `pages_manage_metadata`

This record contains sanitized evidence only. It contains no access tokens,
OAuth codes, cookies, app secrets, customer names, or full provider message IDs.

## Fixture

- Active shop: `ea7f0b95-4e21-5c98-9c64-f850a47fcd84`
- Owner user: `b40b668d-8561-5efb-90b0-33c8c43b26f4`
- Connected channel: `9b361057-4804-451f-8157-bdde836e44f9`
- Page: `1213925798474895` (`Easy Style Fashion`)
- The historical setup document names shop `458b6a78-d409-4740-9fbd-c48875d67155`; production records for that shop contain stale disconnected Page rows. The active authenticated fixture is the shop/channel above.
- Test shop mode before the bounded run: `MANUAL`, `auto_reply_enabled=false`, confidence `80`, max order value `5000`.
- Test shop mode after the bounded run: restored to the same `MANUAL` settings.

## Grounding Marker

- Marker: `EASYMOD_META_PROD_20260922_1046_7F3A`
- Conversation: `e2d7acd0-fd40-4b31-8121-44ab111c2648`
- Negative AI row: `eaf549d3-c5d0-47e7-845f-95cbe2ea6dde`
- Product status: `NOT_FOUND`
- Verified product IDs: none
- Grounding decision: `SEND/GROUNDED`
- Grounding violations: none
- Durable product source references: four same-shop catalog product IDs
- The response said the requested item was not in the catalog and offered two alternatives priced `690` and `1190`.

### Price 690

- Catalog product: `1ce6d322-41af-5f81-b4bf-bab8433fd1c0`
- Name: `Premium Cotton T-Shirt - White`
- Shop: `ea7f0b95-4e21-5c98-9c64-f850a47fcd84`
- Catalog price: `690.00`
- Relationship: `RELATED_PRODUCT`
- Source reference present: `YES`
- Runtime grounding evidence present: `YES`

### Price 1190

- Catalog product: `f41cb1bb-ab58-573a-99e1-ee6d28670143`
- Name: `Essential Casual Shirt - White`
- Shop: `ea7f0b95-4e21-5c98-9c64-f850a47fcd84`
- Catalog price: `1190.00`
- Relationship: `RELATED_PRODUCT`
- Source reference present: `YES`
- Runtime grounding evidence present: `YES`

The other two persisted related references were active same-shop products priced
`1590.00` and `1490.00`; neither was mentioned in the response. The durable row
stores product IDs and titles in `source_references`, while the runtime evidence
snapshot carried the shop binding and known price facts. There is no separate
historical price-version table.

## Media Marker

- Canonical media AI row: `fbfff126-eae1-4b45-8322-b43296d0a060`
- Product status: `VERIFIED`
- Media status: `AVAILABLE`
- Media product: `1ce6d322-41af-5f81-b4bf-bab8433fd1c0`
- Attachment count: `1`
- Provider message ID count: `2` (values intentionally redacted)
- `provider_send_attempted=true`
- `provider_send_confirmed=true`
- `delivered=true`
- Delivery state: `SENT`
- No `delivered=false` media row with an attempted send was found in the recent production search across the deployment.
- No recent `ai_provider_send_failure`, `provider_send_failed`, or `PROVIDER_NO_ACK` log was found.

## Certification Findings

- `scripts/meta-live-e2e.js` rejected NOT_FOUND turns when `source_references` contained related products, even though related alternatives are intentional.
- The same validator rejected every price on NOT_FOUND turns instead of proving each price against a same-shop related catalog row.
- `waitForReplies()` treated the initial `delivered=false` provider-claim state as terminal, allowing the runner to report a media acknowledgement failure before the provider finished.
- Pinned Page discovery ignored the selected shop and status, allowing a stale disconnected duplicate Page row to be selected.

Classification: Grounding Case A and Media Case F. No production application
runtime fix was applied by this investigation.

## Corrected Deployed Run

- Fresh marker: `EASYMOD_META_PROD_20260922_1206_A9C4`
- Final production SHA: `befcb1807b916d92191c6e93f60c5d3408191199`
- Fixture mode during run: `AUTO`; restored afterward to `MANUAL`
- Negative marker: `NOT_FOUND`, no verified product IDs, no related references, no price claims
- Verified product price: exact same-shop catalog value `690`
- Verified attribute: `White`
- Media product: exact verified product ID `1ce6d322-41af-5f81-b4bf-bab8433fd1c0`
- Media attachment count: `1`
- Final media provider components: `TEXT=ACKNOWLEDGED`, `IMAGE=ACKNOWLEDGED`
- Final media provider ID count: `2` (values redacted)
- All fresh AI rows: `provider_send_confirmed=true`, `delivered=true`, `delivery_state=SENT`
- Fresh sequence duplicate sends: `0`
- Fresh conversation DLQ: `0`
- Marker routing: exactly one shop/channel, the approved fixture above
- Restored settings: `automation_mode=MANUAL`, `auto_reply_enabled=false`, confidence `80`, max order value `5000`
