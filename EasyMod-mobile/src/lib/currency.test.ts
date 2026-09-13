import { formatBdCurrency } from './currency';

describe('formatBdCurrency', () => {
  it('formats a number under 1,000 with no grouping', () => {
    expect(formatBdCurrency(500)).toBe('৳500');
  });

  it('groups the first three digits from the right, then by twos (thousands)', () => {
    expect(formatBdCurrency(12345)).toBe('৳12,345');
  });

  it('groups into lakhs correctly', () => {
    expect(formatBdCurrency(1234567)).toBe('৳12,34,567');
  });

  it('groups exactly one lakh correctly', () => {
    expect(formatBdCurrency(100000)).toBe('৳1,00,000');
  });

  it('groups into crores correctly', () => {
    expect(formatBdCurrency(123456789)).toBe('৳12,34,56,789');
  });

  it('omits the currency symbol when withSymbol is false', () => {
    expect(formatBdCurrency(12345, { withSymbol: false })).toBe('12,345');
  });

  it('renders the requested number of decimal places', () => {
    expect(formatBdCurrency(1234.5, { decimals: 2 })).toBe('৳1,234.50');
  });

  it('renders negative amounts with the sign before the digits, after the symbol', () => {
    expect(formatBdCurrency(-500)).toBe('৳-500');
  });

  it('treats non-finite input as zero rather than throwing', () => {
    expect(formatBdCurrency(Number.NaN)).toBe('৳0');
    expect(formatBdCurrency(Number.POSITIVE_INFINITY)).toBe('৳0');
  });

  it('defaults to zero decimal places', () => {
    expect(formatBdCurrency(1234.9)).toBe('৳1,235');
  });
});
