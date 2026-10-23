# Independent Verification - Product Engine V1.3

**Verdict: PASS for the frozen candidate code, backend source, runner binding, and scoped evidence review. Product QA remains FAIL and integration readiness remains NO.**

## Reviewed candidate

- Code commit: 33ca2b76f1fe8f43dce10523ddfec3ab7ff9860d
- Backend source SHA-256: e1168c0e5e9cf6132a379053144f85e94089c4c430664de1f62716f26e6a11fa
- Runner SHA-256: 613801b8e1ca0773e0c4ea928ed4836a370fbe27c13587cbc1dbd0fdd2a66eb0
- Verification receipt: regression/verify-67545ddf-3fd4-49ce-9427-721f8217941c.json; SHA-256 49AA951E3D79E5E658ADFF502417CDC2368185767AFAE5DFEBC136BE6CFB89A1.
- The receipt is complete and bound to this candidate, but its recorded status is FAIL. Its final privacy step saw eight heuristic matches in transient Jest transform-cache filenames in the original evidence root. The receipt is preserved unchanged.

## Independent test run

Reran the integration-mode, verifier, and proof-generator suites offline from EasyMod-backend: 3/3 suites and 66/66 tests passed. The run used an external D: Jest cache, removed paid-provider credentials and opt-ins from its process, and made no provider calls or source edits.

## Evidence reviewed

- The real Gemini source comparison binds to the frozen candidate and current runner. The candidate executed 200/200 turns, verified 18/18 fact slots and 15/15 answerable turns, passed 13/13 context turns and 4/4 safe cross-domain handoffs, and recorded zero unsupported claims and false refusals. Matched-pair estimated cost was $0.03296650; invoices are unavailable.
- PostgreSQL, Redis, message worker, webhook pipeline, product search, fake Meta transport, and full backend regression passed against isolated loopback services. Service listener lifecycle is caller-managed and is not attested by the client connection receipt.
- Playwright passed 6/6 journeys across Chromium, Firefox, and WebKit. Backend security tests passed.
- The 19:11 clean-root privacy scan passed with zero source-contact and text-pattern matches. Its 264-entry manifest had zero duplicates, missing files, hash mismatches, out-of-scope entries, or unlisted files. This scan covered the earlier 19:06 proof snapshot; the final regenerated proof is covered by the later post-proof scan and manifest.
- The clean copy retained 263 evidence files. Excluding integration/tmp and the old checksum manifest, 260 files were byte-identical to the preserved original root; the proof JSON, proof Markdown, and privacy report were refreshed in the clean copy.

## Product and cost limits

- Three genuine photos were tested: category 2/3, visible color 3/3, catalog identity not scored, and only 1/15 required visual case types represented. The vision gate fails.
- Latest V1.3 ledgers total 2,621 requests, 121 vision requests, 5 unknown-usage requests, $0.613131527 estimated usage, and $5.086028023 reserved exposure. Adding V1.2 conservative exposure of $2.339732750 gives $7.425760773 against the manually reconciled $10 authorization, leaving $2.574239227. Provider invoices are unavailable and campaign ledgers do not enforce one shared aggregate cap.
- Twelve standalone raster artifacts were not OCR-scanned.
- No live Meta delivery, production behavior, merchant adoption, order outcomes, conversion, or ROI was tested or established.

The independent PASS is scoped to code/source binding, focused tests, and the reviewed evidence. It does not override the automated QA FAIL, the photo gate failure, or INTEGRATION_READY=NO.
