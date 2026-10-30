# Product presentation contract

**Implementation:** `EasyMod-backend/src/modules/ai/product-experience/product-presentation.js`
**Schema version:** `1`
**Currency default:** `BDT`

## Contract shape

`buildProductPresentation(evidence, { currency, message, language, selectedVariants })` returns a channel-neutral DTO:

```json
{
  "schemaVersion": "1",
  "language": "en",
  "status": "READY",
  "shopId": "fixture-shop-a",
  "selection": "SINGLE",
  "products": [
    {
      "id": "fixture-shop-a-panjabi-black",
      "shopId": "fixture-shop-a",
      "title": "Premium Black Panjabi",
      "titleBn": "প্রিমিয়াম কালো পাঞ্জাবি",
      "price": { "state": "KNOWN", "amount": 2850, "currency": "BDT" },
      "selectedVariant": null,
      "attributes": {
        "material": { "state": "UNCERTAIN", "value": "cotton" },
        "color": { "state": "UNCERTAIN", "value": "black" },
        "size": { "state": "UNKNOWN", "value": null },
        "stock": { "state": "KNOWN", "value": "IN_STOCK" }
      },
      "variants": [],
      "image": { "state": "AVAILABLE", "url": "https://api.easymod.test/uploads/product-images/fixture-shop-a/panjabi-black.jpg" },
      "detailLink": { "state": "UNKNOWN", "url": null }
    }
  ],
  "media": { "state": "AVAILABLE", "productId": "fixture-shop-a-panjabi-black", "url": "https://api.easymod.test/uploads/product-images/fixture-shop-a/panjabi-black.jpg" },
  "detailLink": { "state": "UNKNOWN", "url": null }
}
```

This example is synthetic. Its image host represents the configured public asset/API origin. `KNOWN`, `UNKNOWN`, and `UNCERTAIN` values are explicit. A product price is hidden if variants have differing, missing, or unknown prices unless the current message uniquely names a variant or the latest grounded same-shop conversation context carries that selection. Current explicit selection takes precedence. A prior selection is only a pointer: the router re-reads the product under the current shop and the builder accepts the selection only if that live product still has the same variant ID. The context expires with the product-reference TTL and clears when the latest assistant reply has no product references. A variant with unknown quantity stays unknown. A customer image never becomes merchant media.

## Messenger adapter

`renderMessengerProductPresentation(presentation, language)` returns `{ text, attachments }`. It emits concise text for a valid `READY` presentation and at most one image attachment when media points to the same verified product URL. Media URLs must use an exact configured HTTPS public asset or API origin and the current tenant path. A selected variant includes its known stock state; unknown stock remains unstated. Price/stock claims must identify the matching verified product, and an unqualified price stays blocked when variant prices are ambiguous. The worker's final gate checks the attachment again. Unsupported or blocked presentation falls back to the existing grounded text path. The current adapter does not build Messenger buttons, carousels, or product-detail links; those fields remain `UNKNOWN`.

The controller exposes the DTO as an additive `productPresentation` field, and the worker stores it in existing message metadata. No database migration or order-domain contract was added. The contract has unit validation and local route replay coverage; a live Messenger template/permission test was not run.
