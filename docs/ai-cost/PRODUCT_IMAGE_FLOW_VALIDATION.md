# Product Image Flow Validation

**Date** 2026-07-28 · **status: the upload flow does not exist.** No image bytes are sent
to any AI provider — and no image bytes are stored either. The Add Product form marks
images required, previews them locally, and discards them.

This is reported as a finding, not fixed: building file upload is a storage, security and
cost decision (where the bucket lives, what it costs, how URLs are signed) that belongs to
the founder, not a side-effect of a cost audit. §5 sets out the minimal fix.

---

## 1. Findings

| Question from the brief | Answer | Class |
|---|---|---|
| Are product images uploaded? | **No.** There is no upload endpoint and no multipart handler anywhere in `EasyMod-backend/src`. | [C] |
| Where are they stored? | Nowhere. `products.images` (JSON) and `products.image_url` (string) hold **URLs only**; the validator is `Joi.array().items(Joi.string())`. | [C] |
| How are URLs and metadata saved? | Only if a merchant supplies a URL string via the API. No filename, alt text, caption, dimensions or order metadata is modelled. | [C] |
| Available to storefront / dashboard / inbox / AI responses? | The columns are read by `product-search.service.formatProduct` (`images`, `image_url`) and returned in product payloads, so any consumer *would* get them — there is simply nothing in them. | [C] |
| Are image bytes or URLs sent to Gemini or OpenAI? | **No.** Vision is gated off (§3) and there were no images to send in the first place. | [C] + [M] |
| Are filenames / alt text / captions in textual search? | No — none of those fields exist. `ai_search_text` is built from name, name_bn, category, brand, sku, tags and description. | [C] |
| Is there an unused or partial vision path? | **Yes, three of them.** See §3. | [C] |

### Evidence for "no upload exists"

- No `multer`, `busboy`, `formidable`, `@aws-sdk/client-s3`, `cloudinary`, presigned-URL
  helper, or `multipart/form-data` route in `EasyMod-backend/src`.
- `product.routes.js` exposes no upload route. `product.controller.js` mentions "uploaded
  content" only in a comment on an unrelated AI text-extraction endpoint.
- `AddProduct.tsx:37` holds `productImages: File[]`; the payload assembled at lines 245–296
  never references it. The files are used solely for
  `URL.createObjectURL` previews, revoked on unmount.
- The form labels images **required** (`{t('products.detail.images')} *`, "0/5 images •
  PNG, JPG up to 5MB each"), so the UI promises something the backend cannot accept.

## 2. Cost consequence

The previous audit's headline "one product upload with five images" is therefore **$0.00 as
shipped** — there is no upload, so there is no vision call and no storage write. Under the
locked decisions it stays $0.00 in AI terms even once upload is built, because images will
never be analysed.

What upload *will* cost is storage and bandwidth, not AI:

| Item | Basis | Estimate |
|---|---|---|
| 5 images × 400 KB, one product | [A] typical BD merchant phone photo, compressed | 2 MB |
| 200-product catalogue | 200 × 2 MB | ~400 MB |
| DigitalOcean Spaces | $5/month for 250 GB + 1 TB transfer | **$5/month covers ~125 merchants** |
| Egress on product views | [A] 50 views/product/month × 400 KB | ~4 GB/merchant/month — inside the 1 TB allowance to ~250 merchants |

So the honest number is **~$0.04/merchant/month** of storage and bandwidth at pilot scale,
versus the **$0.001369** of vision cost per 5-image product the previous audit modelled for
the intended-but-nonexistent flow. Storage is the cheaper problem, and it is the real one.

## 3. The three dormant vision paths

| Path | What it did | Recommendation |
|---|---|---|
| `product-ai.service.processProduct` | sent `images[0]` to **OpenAI vision as a forced primary provider** on every product create/update, then wrote the `ai_*` columns | **Retain as dormant.** Rewritten so the default path derives attributes from text; the vision branch survives behind `AI_VISION_ENABLED`. |
| `intent-router._extractProductAttributes` | sent a customer's photo to the chain for JSON attribute extraction, then sent every image again in the final reply call | **Retain as dormant.** Gated; image blocks now stripped from the final payload too. |
| `image-product-matcher.matchViaVision` + `clip-client.service` | CLIP image embeddings (tier 1) and a Gemini vision description (tier 3) | **Retain as dormant.** Both gated; `matchViaVision` returns `method: 'vision_disabled'`. |

**Why dormant rather than deleted.** All three are behind one switch with one clear
meaning, they are covered by tests that assert the off-state, and `image_understanding` is
still advertised as a plan feature (§4) — so the founder may want them back. Deleting them
would also delete the only worked examples of how to call the chain multimodally. The
switch, not the code, is what needed to change.

One genuinely dead thing *was* found and is worth deleting separately:
`llm.service.hasVisionContent` is defined and never called, and
`llm-tier-selection.service.js` (238 lines, a whole tier→model mapping including the
retired `gemini-2.0-flash`) has no callers at all. Both are in the backlog.

## 4. The pricing-page conflict — RESOLVED 2026-08-03

> **Option 2 was taken.** The switch was split per path, exactly as this section
> anticipated: `AI_PHOTO_MATCH_ENABLED` (default **on**) analyses the customer's
> photo; `AI_VISION_ENABLED` (default **off**) still governs merchant
> product-image analysis and re-attaching image bytes to the reply call.
>
> One refinement on the costing below: the photo reaches a model **once**, not
> twice. The extraction call carries the image; the reply call is text-only,
> grounded on the returned description plus live catalog rows. So the "+$0.0008
> per conversation, ~13%" figure holds at 3 photo messages, and the reply call
> adds no image tokens at all.
>
> §5 below is superseded by the shipped implementation — uploads landed on the
> `backend_uploads` Docker volume rather than DO Spaces, and matching runs on
> text-derived `ai_*` attributes, so it does **not** depend on product images
> existing. The section is kept as the record of what was scoped.

### Original analysis

`subscription.plans.js` sets `image_understanding: true` in `BASE_FEATURES`, and
`Pricing.tsx` renders it as a bullet on the public pricing page via
`pricing.features.imageUnderstanding`.

With vision off, the bot cannot identify a product from a photo; it asks the customer to
type the name. **The advertised feature is not delivered.** This is the most important
product consequence of the locked decisions, and it is a founder decision, so the flag was
deliberately **not** changed here — flipping it edits the pricing page.

Three options, in increasing cost:

1. **Remove the claim.** Free. The bot still handles photo messages gracefully (it answers
   from the caption plus the product search, and is instructed not to pretend it saw the
   image).
2. **Re-enable vision for customer photos only** (`AI_VISION_ENABLED=true` re-enables all
   four paths, so this would need the switch split per path). Measured cost: ~1,065 input
   tokens per image on the primary model, billed **flat regardless of resolution** — so
   compressing customer images saves nothing. At 3 photo messages per conversation that is
   roughly +$0.0008/conversation, ~13% on top of the $0.006143 total.
3. **Re-enable vision everywhere**, including product upload. Adds the upload flow's cost
   plus ~$0.001369 per 5-image product.

## 5. Minimal fix, if the founder wants working images

Not implemented here. Scoped for completeness:

1. **Storage** — DigitalOcean Spaces in the same region as the droplet (the AWS migration
   plan on `codex/aws-domain-migration-plan` is parked, so Spaces avoids pre-committing to
   S3). $5/month flat.
2. **Backend** — one route, `POST /product/images`, accepting up to 5 files ≤5 MB, MIME
   allowlist `image/jpeg|png|webp`, magic-byte validation (not just the declared MIME),
   per-shop key prefix, returning the public URLs. Multer memory storage plus the S3 SDK;
   Spaces is S3-compatible.
3. **Frontend** — `AddProduct.tsx` uploads on submit, then puts the returned URLs into
   `productData.images`. The form already collects and validates the files.
4. **Reorder / replace / delete** — `images` is an ordered JSON array, so reorder is a
   client-side array move plus a `PUT`. Delete needs the object removed from the bucket
   too, or orphans accumulate.
5. **AI grounding** — nothing to do. `formatProduct` already returns `images` and
   `image_url`, so once they are populated the inbox and any product card get them for
   free, and the AI can reference a stored product's image without any image ever reaching
   a model.

**Do not add** caption generation, visual attribute extraction, OCR, image embeddings,
multimodal product search, or automatic vision classification — all excluded by the locked
decisions, and none of them are needed for images to work.
