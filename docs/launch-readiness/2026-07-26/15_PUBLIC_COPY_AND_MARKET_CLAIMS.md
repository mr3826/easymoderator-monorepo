# 15 — Public Copy and Market Claims (Workstream N)

**Verdict for this workstream: PASS with two P2 corrections.**

Reviewed the **live** site at `https://easymod.tech` (rendered, not just source) plus the
repository copy. This is the strongest area of the product's launch posture.

## Prohibited claims — all clean

| Claim category | Present? | Evidence |
|---|---|---|
| Instagram | **No** | grep of `LandingPage.tsx` → 0 hits; live text → 0 hits |
| WhatsApp | **No** | same |
| Omnichannel automation | **No** | same |
| Facebook comments / comment-to-DM | **No** | same |
| Unsupported marketing messages | **No** | copy explicitly says out-of-window replies are blocked |
| Guaranteed revenue increases | **No** | no guarantee language |
| Unsupported fraud prevention | **No** | RTO Shield described as "flagged", not prevented |
| Unsupported order volume claims | **No** | — |
| "Fully automatic customer service" | **No** | opposite: "Draft — AI replies first", "it pauses and asks you to reply personally" |
| Fabricated testimonials | **No** | see below |
| "24/7" conflicting with policy | **No** | not claimed |

The site actively advertises its own constraints, which is exactly right for a
Meta-reviewed product:

> "The first launch uses only Facebook Messenger DMs and blocks out-of-window replies
> until a current reviewed messaging path is available."

> "Keep Meta compliance simple: Messenger DM-only, opt-out aware, and no comment or
> cold-DM automation."

### Testimonials — correctly framed

The "PILOT SCORECARD" block carries city labels (Dhaka, Chittagong, Sylhet) and
metric-style quotes, which *look* like testimonials. They are explicitly headed **"What we
will prove with launch shops"** and phrased as goals ("Reduce buyer response time…",
"Capture cleaner COD order details…"). This is honest framing of intent, not fabricated
social proof. **PASS.**

## Page-by-page

| Page | Status |
|---|---|
| Homepage | 200, renders, no console errors |
| Pricing (section) | 200, ৳999/mo Growth + ৳10-15/delivered partner tier |
| FAQ | in-app FAQ settings; no public FAQ page |
| Demo | "View Demo" CTA present |
| Signup / Login | 200, renders, bilingual toggle, "Private BD seller pilot" badge |
| Privacy Policy | **200, full policy renders without authentication** — Meta requirement met |
| Terms of Service | **200** — Meta requirement met |
| Data deletion | callback live and fail-closed; policy documents the process |
| Contact / support | present in footer |
| Footer links | Privacy Policy, Terms of Service, Sign In — all resolve |
| Social-preview metadata | **absent** — no `og:` or `twitter:` tags in the served HTML |
| Mobile rendering | **PASS** — 375px: `scrollWidth 375 === innerWidth 375`, no horizontal overflow |
| Broken links | none found on the paths tested |
| SEO metadata | minimal — `<title>EasyModerator</title>`, no `meta description` |
| CSP errors | none |
| Console errors | **none** |

## Findings

### F-23 (P2) — the ROI calculator asserts an unsubstantiated 20% figure

The calculator projects "৳18,450 saved/month", "75 hours saved", "60 fake orders avoided"
from a 300-order input, with the basis disclosed:

> "Based on ~5 min saved per conversation and ~20% COD return rate avoided."

Disclosing the assumption is good practice. But **"~20% COD return rate avoided"** is a
strong effectiveness claim for a product with zero activated shops and no measured
outcome. A prospective merchant reads "৳18,450 saved/month" as a projection the vendor
stands behind.

**Remediation:** soften to an illustrative example ("if RTO Shield avoids 20% of COD
returns…"), or gate the calculator behind pilot data. Revisit once gate 7 (10 activated
shops) produces real numbers.

### F-24 (P2) — courier feature card vs. "0 couriers built-in"

The stat strip honestly reads **"0 — BD couriers built-in"**, while the features grid
promises *"Courier Integrations — Book delivery across supported providers"*. No courier
credentials exist in production. Qualify the card as "coming soon" or configure a
provider. (Also recorded in `14_`.)

### F-32 (P3) — stale copyright year

Footer reads **"© 2025 EasyModerator"**. Current date is 2026-07-26.

### F-33 (P3) — no social-preview or SEO metadata

The served `index.html` has no `og:title`, `og:description`, `og:image`, or
`meta description`. Every link shared to Facebook or WhatsApp — the primary channels for
a BD f-commerce audience — will render as a bare URL. This is a marketing-effectiveness
gap, not a compliance one, but it matters before ad spend.

## Consistency with the Meta review package

Public copy, privacy policy, and the reviewer package all state the same scope:
Facebook Page Messenger DMs only, no Instagram, no WhatsApp, no comment automation. **No
contradiction found between what is sold, what is documented to Meta, and what the code
does.** That three-way consistency is the single best signal in this audit.
