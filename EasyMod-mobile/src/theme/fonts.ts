import {
  HindSiliguri_400Regular,
  HindSiliguri_500Medium,
  HindSiliguri_600SemiBold,
  HindSiliguri_700Bold,
} from '@expo-google-fonts/hind-siliguri';

/**
 * Font map passed to `useFonts` (from `expo-font`) in the root layout. Bengali-first UX
 * (MOBILE_PRODUCT_SPEC.md §3) requires a font that renders Bengali script well; Hind Siliguri is
 * the font the web app already uses (CURRENT_STATE.md §12).
 */
export const fontsToLoad = {
  HindSiliguri_400Regular,
  HindSiliguri_500Medium,
  HindSiliguri_600SemiBold,
  HindSiliguri_700Bold,
} as const;
