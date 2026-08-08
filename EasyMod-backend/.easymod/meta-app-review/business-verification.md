# Meta Business Verification — Bangladesh Procedure

**App:** EasyModerator
**Legal entity:** Hexabyte Technologies (registered in Bangladesh) — <https://hexabyte.tech>
**Last updated:** 2026-07-28

This is the step that gates everything else. **App Review cannot grant Advanced
Access to `pages_messaging` until the business portfolio that owns the app is
verified.** You can submit App Review before verification finishes, but the
permission will not go live for non-tester users until it does — so start this
first, because it is the longest lead time in the whole launch (typically 2–10
business days, occasionally longer if a document is rejected).

> **Authority note.** Meta changes accepted-document lists and screen names
> often, and it varies by country. Everything below is the procedure as it
> stands; where a list could have moved, this file says so and tells you where
> the dashboard shows the authoritative version. Trust the dashboard over this
> file when they disagree, then correct this file.

---

## 0. Prerequisites — collect these before you open the dashboard

Get all of this in one folder first. The single most common cause of rejection
is a mismatch between what you type into Meta and what the document says.

| Item | Where it comes from | Must match |
|---|---|---|
| Legal business name | Trade License / RJSC incorporation certificate | Exactly what you type in Business Manager — including "Limited" vs "Ltd." |
| Business street address | Trade License | Exactly, including district and postcode |
| Business phone number | Must be reachable — Meta may call or SMS it | — |
| Business email on your own domain | e.g. `admin@easymod.tech` — **a Gmail/Yahoo address will usually fail** the association step | Domain you control |
| Website | `https://easymod.tech` | Must be live and describe the business |

### Documents — Bangladesh

Meta asks for **one** document proving the business exists, and sometimes a
**second** proving your association with it. For a Bangladeshi private limited
company these are the ones normally accepted:

**Primary (business existence) — pick one:**

1. **Trade License** issued by the City Corporation / Pourashava / Union
   Parishad — the usual first choice, and the one this file assumes.
2. **Certificate of Incorporation** from RJSC.
3. **TIN Certificate** (e-TIN) from NBR.
4. **VAT / BIN Registration Certificate** from NBR.

**Secondary (address / association) — if Meta asks for a second document:**

5. Business bank statement (issued within the last 90 days).
6. Utility bill in the business name (issued within the last 90 days).

**Document rules that get people rejected:**

- Upload the **whole page**, all four corners visible, nothing cropped.
- **No edits, no redactions, no highlighting.** A blacked-out field is treated
  as tampering. If you are uncomfortable showing a number, that is not a reason
  to redact — it is a reason to pick a different document.
- Colour scan or a sharp photo. Not a photocopy of a photocopy.
- **The Trade License must not be expired.** BD trade licenses renew annually
  (Bengali fiscal year); if yours lapsed, renew before uploading.
- If the document is in Bengali, Meta generally accepts it, but attach a
  translation if the dashboard offers the option. Names must transliterate to
  exactly the Latin-script name you entered.
- File format: PDF, JPG, or PNG. Keep it under the size limit the upload widget
  states.

---

## 1. Create / confirm the business portfolio

1. Go to **business.facebook.com** → **Business settings**.
2. **Business info** → confirm: legal name, address, phone, website.
   - This is the screen whose values must match the Trade License **character
     for character**. Fix it here *before* uploading anything.
3. Confirm the **EasyModerator app** is listed under **Accounts → Apps**. If
   the app was created under a personal account, add it to the business
   portfolio now — an app outside the portfolio does not inherit its
   verification.

## 2. Verify the domain

**Business settings → Brand safety and suitability → Domains** → add
`easymod.tech`.

Choose **DNS TXT record** (simplest here — you control the apex DNS for the
droplet already):

1. Meta shows a `facebook-domain-verification=<token>` value.
2. Add it as a TXT record on the apex `easymod.tech`.
3. Wait for propagation, then click **Verify**.

Check it from a shell before clicking Verify:

```bash
dig +short TXT easymod.tech | grep facebook-domain-verification
```

Domain verification is separate from business verification and is fast. Do it
while the document review is pending.

## 3. Start business verification

**Business settings → Security Centre** (some accounts show it under
**Business info**) → **Start verification**.

1. Confirm the business details Meta pre-fills from step 1. Correct anything
   that does not match the Trade License.
2. Select country **Bangladesh** — the accepted-document list redraws for BD.
   **This list is authoritative; if it differs from §0 above, follow the
   dashboard and update this file.**
3. Upload the Trade License.
4. Complete the **association** step. Meta offers some subset of:
   - a code sent by **SMS or phone call** to the business phone number;
   - a code emailed to an address **on your verified domain** (this is why
     `admin@easymod.tech` matters);
   - an additional document naming you as a director/officer.

## 4. Wait, and respond fast

- Status lives in **Security Centre**. It moves Pending → Verified, or Pending →
  More information needed / Rejected.
- **If rejected, you generally get a limited number of resubmissions.** Do not
  re-upload the same document hoping for a different reviewer. Read the stated
  reason, fix the actual mismatch, then resubmit.
- The two rejection reasons that dominate: **name mismatch** (e.g. dashboard
  says "Hexabyte Tech", licence says "Hexabyte Technologies") and **address
  mismatch**. Enter the entity name exactly as the trade licence spells it —
  if the licence and this file ever disagree, the licence wins and this file
  is what needs correcting.

---

## 5. Related reviews you will also be asked for

These are separate from business verification. Knowing they exist stops them
being a surprise mid-launch.

| Review | What it is | When it hits |
|---|---|---|
| **Data Protection Assessment (DPA)** | A questionnaire about how you store, share and secure Platform data. Apps handling Page/messaging data are routinely selected. | Usually after App Review approval; you get a deadline. Missing it suspends the app. |
| **Data Use Checkup** | Annual re-attestation that your permission use is still accurate. | Annually, from the App Dashboard. |
| **Tech Provider status** | Meta classifies apps that manage assets *on behalf of other businesses* — which is exactly what EasyModerator does with merchant Pages. If the dashboard offers/requires a Tech Provider business type, it requires verification too. | Check during setup; confirm in the dashboard. |

For the DPA, the answers are already documented — `permissions-justification.md`
(what each scope does and its retention) and `data-deletion-flow.md` (deletion
mechanics). Do not answer a DPA freehand; answer it from those two files so the
story matches what App Review was told.

---

## 6. Sequencing

Run these in parallel, not in series — the two Meta-side waits overlap:

```
Day 0   Collect documents (§0)  ─┐
        Fix Business info (§1)   │
        Verify domain (§2)       │
        Submit verification (§3) ├─ Meta reviews (2–10 business days)
        Record screencast        │   ← do this during the wait, not after
        Submit App Review        ─┘
Day N   Business verified + App Review approved → switch app to Live
```

Submitting App Review before verification completes is fine and saves a week.

## 7. Founder checklist

- [ ] Trade License located, unexpired, full-page scan
- [ ] Business info in Business Manager matches the licence character for character
- [ ] `easymod.tech` domain verified (TXT record confirmed via `dig`)
- [ ] EasyModerator app is inside the business portfolio
- [ ] Business email on `@easymod.tech` exists and is reachable
- [ ] Business phone reachable for SMS/call
- [ ] Verification submitted; date submitted: ____________
- [ ] Verified — date: ____________

See also: `compliance-checklist.md`, `dashboard-setup-walkthrough.md`.
