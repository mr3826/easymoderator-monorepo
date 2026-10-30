// FE-01: the inbox composer's built-in quick-reply FALLBACKS must never assert
// business facts (order status, payment, stock, courier, charges, policy
// windows, dates). Merchant-authored templates are untouched; anything a
// customer could read as a business truth must come from a merchant template
// or an authoritative read, never from these hard-coded defaults.
import { describe, it, expect } from 'vitest'
import { buildFallbackTemplates } from '@/app/components/UnifiedInbox'

const t = (key: string) => `LBL:${key}`

// Vocabulary that, inside a reply sent to a customer, claims a business fact.
const FORBIDDEN_CLAIM =
  /(confirm|confirmed|paid|payment|advance|bkash|nagad|rocket|stock|courier|dispatch|deliver|charge|৳\s?\d|refund|return|exchange|available|COD|cash on delivery|korechi|kora hoyeche|deya hoyeche|পেমেন্ট|অগ্রিম|পরিশোধ|স্টক|কুরিয়ার|ডেলিভারি|পাঠানো|আজকেই|দিনের মধ্যে|দিনে জানাবেন|কনফার্ম|নিশ্চিত কর|ফেরত|বিনিময়)/i

describe('FE-01 quick-reply fallback safety', () => {
  const templates = buildFallbackTemplates(t)

  it('contains no business-fact claims in any fallback content', () => {
    for (const tpl of templates) {
      expect(
        tpl.content,
        `fallback "${tpl.id}" asserts a business fact: ${tpl.content}`
      ).not.toMatch(FORBIDDEN_CLAIM)
    }
  })

  it('contains no business-fact claims in any fallback label', () => {
    // Labels are i18n keys here; production passes translated names — assert
    // the key set itself is claim-free (no orderConfirmed/dispatchToday/etc.)
    const keys = templates.map((tpl) => tpl.name)
    expect(keys.join(' ')).not.toMatch(/orderConfirmed|courierUpdate|advancePayment|outOfStock|deliveryCharge|returnWindow|cashOnDelivery|dispatchToday/)
  })

  it('every fallback is a request for information or a promise to follow up', () => {
    for (const tpl of templates) {
      const isFollowUpPromise = /check|নিচ্ছি|পেয়েছি|শীঘ্রই|উত্তর|rectifying|please/i.test(tpl.content)
      const isInformationRequest = /[?？🙏]|\d*\s*(ঠিকানা|নম্বর|detail|address)/i.test(tpl.content)
      expect(
        isFollowUpPromise || isInformationRequest,
        `fallback "${tpl.id}" neither promises a follow-up nor requests info`
      ).toBe(true)
    }
  })

  it('stays small (<= 5 neutral entries)', () => {
    expect(templates.length).toBeLessThanOrEqual(5)
  })

  it('each entry carries an i18n label key and non-empty content', () => {
    for (const tpl of templates) {
      expect(tpl.name).toMatch(/^LBL:inbox\.templates\./)
      expect(tpl.content.trim().length).toBeGreaterThan(0)
    }
  })
})
