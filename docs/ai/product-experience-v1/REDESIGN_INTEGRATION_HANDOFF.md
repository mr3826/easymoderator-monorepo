# Redesign integration handoff

## What the redesign can consume

The optional `productPresentation` response/metadata value is schema version `1` and carries tenant, language, selection, product title, typed price and attribute states, variants, media, and detail-link states. The display must preserve `UNKNOWN` and `UNCERTAIN` rather than rendering them as facts. Use [PRODUCT_CONTRACTS.md](PRODUCT_CONTRACTS.md) and the validator in `EasyMod-backend/src/modules/ai/product-experience/product-presentation.js` as the source contract.

The controller returns the DTO additively. The message worker stores it in existing message metadata and continues to enforce the outbound evidence gate. A Messenger text renderer can provide concise text and a verified product image attachment. It does not yet emit buttons, carousel templates, or detail links.

## Integration checks still required

1. Bind the DTO to the redesign's current inbox/conversation response types and confirm older clients tolerate the additive field.
2. Render `READY` and `BLOCKED` states, Bengali titles, selected/unavailable variants, unknown prices, and multiple-product clarification at the redesign's 1024px and 768px breakpoints.
3. Exercise the actual Messenger provider's attachment/template rules and permissions with authorized local test credentials.
4. Verify persisted message metadata through the real database and context lookup through worker retries/out-of-order events.
5. Obtain merchant and founder review before any controlled pilot decision.

No redesign worktree or frontend/mobile file was changed in this implementation.
