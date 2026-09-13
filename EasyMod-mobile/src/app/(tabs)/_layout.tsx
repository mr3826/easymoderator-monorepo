import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Home, Inbox, Menu, PlusCircle, Package } from 'lucide-react-native';

import { brandColors } from '@/theme/tokens';

/**
 * The Phase 1 tab shell (MOBILE_ARCHITECTURE.md §3): Home · Inbox · + (quick action) · Orders ·
 * More. Each screen is a placeholder for now — Phase 2+ builds the real feature screens.
 */
export default function TabsLayout() {
  const { t } = useTranslation();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: brandColors.primary,
        tabBarInactiveTintColor: brandColors.text,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('mobile.tabs.home'),
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: t('mobile.tabs.inbox'),
          tabBarIcon: ({ color, size }) => <Inbox color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="quick-action"
        options={{
          title: t('mobile.tabs.quickAction'),
          tabBarIcon: ({ color, size }) => <PlusCircle color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: t('mobile.tabs.orders'),
          tabBarIcon: ({ color, size }) => <Package color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: t('mobile.tabs.more'),
          tabBarIcon: ({ color, size }) => <Menu color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
