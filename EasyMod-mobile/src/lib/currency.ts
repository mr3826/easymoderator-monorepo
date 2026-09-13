/**
 * BDT currency formatting with Bangladeshi ("lakh/crore") digit grouping: the first group from
 * the right is 3 digits, every group after that is 2 digits (e.g. 1234567 -> "12,34,567").
 *
 * Implemented manually rather than via `Intl.NumberFormat('bn-BD' | 'en-IN', ...)` because
 * Hermes' bundled ICU data is build-dependent and not guaranteed to include Indian-style grouping
 * on every device this app targets (MOBILE_PRODUCT_SPEC.md §4 — low-end/older Android) — a
 * hand-rolled grouping is small, dependency-free, and testable without an ICU polyfill.
 */

export interface FormatBdCurrencyOptions {
  /** Include the ৳ symbol. Defaults to true. */
  withSymbol?: boolean;
  /** Number of decimal (paisa) places to show. Defaults to 0 — BDT is conventionally shown whole. */
  decimals?: number;
}

/** Groups a non-negative digit string as 3 + repeating 2s, e.g. "1234567" -> "12,34,567". */
function groupIndianStyle(digits: string): string {
  if (digits.length <= 3) return digits;

  const lastThree = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const groups: string[] = [];
  for (let i = rest.length; i > 0; i -= 2) {
    const start = Math.max(0, i - 2);
    groups.unshift(rest.slice(start, i));
  }
  return groups.join(',') + ',' + lastThree;
}

export function formatBdCurrency(amount: number, options: FormatBdCurrencyOptions = {}): string {
  const { withSymbol = true, decimals = 0 } = options;

  if (!Number.isFinite(amount)) amount = 0;

  const fixed = Math.abs(amount).toFixed(decimals);
  const [intPart, decimalPart] = fixed.split('.');
  const sign = amount < 0 ? '-' : '';
  const grouped = groupIndianStyle(intPart);
  const withDecimals = decimalPart ? `${grouped}.${decimalPart}` : grouped;

  return `${withSymbol ? '৳' : ''}${sign}${withDecimals}`;
}
