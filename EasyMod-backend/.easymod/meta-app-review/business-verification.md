# Meta Business Verification — Bangladesh Procedure

**App:** EasyModerator
**Legal entity:** Hexabyte Technologies (registered in Bangladesh) — <https://hexabyte.tech>
**Last updated:** 2026-08-20

> **Status — 2026-08-20: business verification is COMPLETE.** App settings →
> Basic → Business portfolio shows **HexaByte Technologies**, ID
> `1268762121859445`, ● Verified. Sections 0–4 below are kept as the procedure
> record; you do not need to run them again. The remaining verification gate is
> **Access Verification (Tech Provider)** — section 6 — which is *not started*
> and carries a hard deadline of **2026-10-19**.

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
| **Access Verification (Tech Provider)** | **Confirmed required, not started.** `pages_show_list` sits in the dashboard's Tech-Provider-gated section. Merchants without a role on the app cannot grant it until HexaByte is verified as a Tech Provider. Separate from, and not satisfied by, App Review. | **Deadline 2026-10-19** — the dashboard warns of app restrictions past that date. Full procedure in section 6. |

For the DPA, the answers are already documented — `permissions-justification.md`
(what each scope does and its retention) and `data-deletion-flow.md` (deletion
mechanics). Do not answer a DPA freehand; answer it from those two files so the
story matches what App Review was told.

---

## 6. Access Verification (Tech Provider) — OPEN

**Confirmed in the dashboard on 2026-08-20. This is the only verification gate
still outstanding, and the only one with a deadline.**

App settings → Basic → Business portfolio → **Access verification** →
*View details* opens
<https://developers.facebook.com/1268762121859445/access-verification/>, which
currently reads:

> Answer the following questions so we can verify that your business is a Tech
> Provider. Only complete this for your own business, HexaByte Technologies.
> **To avoid restrictions to 1 app, this must be completed by 10/19/2026.**

### Why it applies to us

`pages_show_list` appears in the dashboard section headed *"Your app only needs
advanced access to the following permissions and features if your business
provides services of a Tech Provider. Business verification and access
verification are required."* EasyModerator connects **other businesses'** Pages,
so it is squarely a Tech Provider integration.

Without it, once the app leaves Development mode every merchant who does not
hold a role on the app fails with error code 100 — *"Unsupported get request.
Object with ID does not exist, cannot be loaded due to missing permissions, or
does not support this operation."* That is every real customer.

Passing App Review does **not** satisfy this, and completing this does not
substitute for App Review. They are independent gates.

### What to do

1. Only a **Business admin** of HexaByte Technologies can complete it — the
   founder, not a developer holding only an app role.
2. Prerequisites are already met: business verification passed, and there are
   no restrictions on the business account.
3. Open the link above → **Start verification** → categorise and describe how
   HexaByte uses other businesses' data to provide a service to them. Answer
   from `permissions-justification.md` so the story matches what App Review is
   told.
4. Decision takes roughly **5 days**. Business admins get an email; app admins
   get a developer alert.

Verified status can lapse — it is lost if the business becomes unverified, the
app is disconnected from the business, or the business account is restricted,
and returns automatically once that is reversed.

---

## 7. Sequencing

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

## 8. Founder checklist

- [ ] Trade License located, unexpired, full-page scan
- [ ] Business info in Business Manager matches the licence character for character
- [ ] `easymod.tech` domain verified (TXT record confirmed via `dig`)
- [ ] EasyModerator app is inside the business portfolio
- [ ] Business email on `@easymod.tech` exists and is reachable
- [ ] Business phone reachable for SMS/call
- [x] Verification submitted
- [x] Verified — HexaByte Technologies, ID `1268762121859445` (confirmed 2026-08-20)
- [ ] **Access verification (Tech Provider) submitted — date: ____________**
- [ ] **Tech Provider approved — date: ____________**  ← deadline 2026-10-19

See also: `compliance-checklist.md`, `dashboard-setup-walkthrough.md`.
