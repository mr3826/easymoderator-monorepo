import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Home, Inbox, Menu, PlusCircle, Package } from 'lucide-react-native';

import { brandColors } from '@/theme/tokens';

/**
 * The Phase 1 tab shell (MOBILE_ARCHITECTURE.md §3): Home · Inbox · + (quick action) · Orders ·
 * More. Each screen is a placeholder for now — Phase 2+ builds the real feature screens. Tab buttons
 * carry stable testIDs (`tab-*`) so device E2E does not depend on the Bengali/English labels.
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
          tabBarButtonTestID: 'tab-home',
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: t('mobile.tabs.inbox'),
          tabBarButtonTestID: 'tab-inbox',
          tabBarIcon: ({ color, size }) => <Inbox color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="quick-action"
        options={{
          title: t('mobile.tabs.quickAction'),
          tabBarButtonTestID: 'tab-quick-action',
          tabBarIcon: ({ color, size }) => <PlusCircle color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: t('mobile.tabs.orders'),
          tabBarButtonTestID: 'tab-orders',
          tabBarIcon: ({ color, size }) => <Package color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: t('mobile.tabs.more'),
          tabBarButtonTestID: 'tab-more',
          tabBarIcon: ({ color, size }) => <Menu color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
