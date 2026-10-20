# Dataset Oracle and Coverage

## Dataset integrity

The original `customer-simulator.csv` was not modified. Its SHA-256 is `892fb83191cc5fbfab48a30551f1095faedd5fd8ee2a238ccfa44a46b38254e6`. It contains 200 ordered turns across 20 personas, ten turns each. Input types are 179 text, 17 image-text, 3 image, and 1 image-image. The language labels are 46 Bangla, 123 Banglish, 28 English, and 3 other. Raw customer text, per-row unsalted hashes, free-text responses, and unsalted response digests are not persisted in run receipts or exposed by the Lab dataset API; only the dataset-wide hash is retained. Replay response text is evaluated in memory and saved as structured scores with `responseTextStored:false`.

## Oracle policy

The oracle is response-blind and independent of the CSV's suggested answer. A fact slot is answerable only when a unique synthetic tenant product and authoritative catalog field are available from the current text or valid prior text context. Image-bearing turns are classified `image_dependent` and `NOT_ANSWERABLE` in the offline replay because no real vision provider processed image pixels. Context that depends on an unevaluated image is not promoted to text-only product evidence.

## Candidate coverage and outcomes

The candidate executed all 200 turns sequentially within personas and isolated tenants. Its domain counts are:

| Domain | Turns |
|---|---:|
| Product | 3 |
| Image-dependent | 20 |
| Product identity unresolved | 118 |
| Outside product | 23 |
| Merchant policy | 34 |
| Unknown product attribute | 2 |

There are 21 media-bearing input records (17 image-text, 3 image, 1 image-image); 20 require image interpretation for product evaluation. One image-text record is classified as a merchant-policy question, so it is not counted as image-dependent.

There were 2 answerable product fact slots and both were correctly answered: **2/2 (100%)**. Of the 200 turns, 198 were classified `NOT_ANSWERABLE` under the available synthetic catalog and offline authority. Candidate outcomes include 139 `SEND` and 61 `SAFE_FALLBACK`; unsupported claims sent: 0; unnecessary refusals among eligible slots: 0; tenant scope violations: 0; unscoped catalog reads: 0. These numbers are not a general 200-turn product accuracy score.

A separate fixed synthetic catalog evaluation covered 7 cases, 6 with answerable facts and 8 eligible fact slots. The candidate scored **8/8 correct fact slots (100%)**, with tenant isolation and product-presentation contract checks passing. Unknown material remained outside the answerable denominator.

## Remaining coverage gap

The 118 unresolved product-identity turns show that the small synthetic catalog cannot adjudicate most source requests. The 20 image-dependent turns require actual raster-image processing. Real merchant catalogs, policies, order/payment/courier state, visual matching, and customer satisfaction were not established. Those results remain `NOT_RUN` or unanswerable, not inferred from source expectations.
