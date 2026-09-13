import { useTranslation } from 'react-i18next';

import { PlaceholderScreen } from '@/components/PlaceholderScreen';

export default function QuickActionScreen() {
  const { t } = useTranslation();
  return <PlaceholderScreen label={t('mobile.placeholder.phase2', { screen: t('mobile.tabs.quickAction') })} />;
}
