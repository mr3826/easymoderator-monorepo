import { useTranslation } from 'react-i18next';

interface LanguageToggleProps {
  /** Visual variant — use 'light' on dark backgrounds, 'dark' on light backgrounds */
  variant?: 'light' | 'dark';
}

export default function LanguageToggle({ variant = 'dark' }: LanguageToggleProps) {
  const { i18n } = useTranslation();
  const isBn = i18n.language === 'bn';

  const toggle = () => {
    i18n.changeLanguage(isBn ? 'en' : 'bn');
  };

  const base =
    'inline-flex items-center rounded-full border text-xs font-semibold cursor-pointer select-none transition-colors h-7 overflow-hidden';

  const styles =
    variant === 'light'
      ? 'border-white/30 bg-white/10 text-white hover:bg-white/20'
      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 shadow-sm';

  const activeSegment = variant === 'light' ? 'bg-white/25' : 'bg-emerald-600 text-white';
  const inactiveSegment = 'opacity-60';

  return (
    <button
      type="button"
      onClick={toggle}
      className={`${base} ${styles}`}
      aria-label={isBn ? 'Switch to English' : 'বাংলায় পরিবর্তন করুন'}
      title={isBn ? 'Switch to English' : 'Switch to Bengali'}
    >
      <span className={`px-2.5 py-0.5 rounded-full transition-all ${isBn ? activeSegment : inactiveSegment}`}>
        বাং
      </span>
      <span className={`px-2.5 py-0.5 rounded-full transition-all ${!isBn ? activeSegment : inactiveSegment}`}>
        EN
      </span>
    </button>
  );
}
