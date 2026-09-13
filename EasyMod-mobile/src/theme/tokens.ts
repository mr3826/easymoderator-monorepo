/**
 * Brand design tokens.
 *
 * Source of truth: docs/mobile/CURRENT_STATE.md §12, which documents the web app's
 * (`EasyMod-frontend`) existing brand tokens. Mobile copies these values verbatim rather than
 * importing them (ADR M-001 forbids cross-module imports), so any future brand change must be
 * applied in both places deliberately.
 */

export const brandColors = {
  primary: '#00A651',
  primaryDark: '#008040',
  text: '#030213',
  destructive: '#d4183d',
  background: '#F9FAF8',
} as const;

export const radius = {
  /** The web app's single corner-radius token, used everywhere a card/button needs rounding. */
  default: 10,
} as const;

export const fontFamily = {
  /**
   * Hind Siliguri, loaded via `@expo-google-fonts/hind-siliguri` (see `src/theme/fonts.ts`).
   * Falls back to the platform default sans-serif until the font finishes loading.
   */
  regular: 'HindSiliguri_400Regular',
  medium: 'HindSiliguri_500Medium',
  semiBold: 'HindSiliguri_600SemiBold',
  bold: 'HindSiliguri_700Bold',
} as const;

export const spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** Neutral tones that aren't part of the official brand palette but are needed for surfaces/borders. */
export const neutral = {
  border: '#E5E7EB',
  muted: '#6B7280',
  surface: '#FFFFFF',
  overlay: 'rgba(3, 2, 19, 0.5)',
} as const;

export type BrandColor = keyof typeof brandColors;
