import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from 'react-i18next';
import { MessageSquare, Truck, CreditCard, Building2, ArrowUpDown } from "lucide-react";
import PlatformPrioritySettings from './PlatformPrioritySettings';

type SettingsTab = 'chat' | 'delivery' | 'payment' | 'business' | 'priority';

export default function ManageShop() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<SettingsTab>('business');

  useEffect(() => {
    if (location.pathname.endsWith('/manage-shop/chat-settings')) {
      setActiveTab('chat');
    } else if (location.pathname.endsWith('/manage-shop/delivery-settings')) {
      setActiveTab('delivery');
    } else if (location.pathname.endsWith('/manage-shop/payment-settings')) {
      setActiveTab('payment');
    } else {
      setActiveTab('business');
    }
  }, [location.pathname]);

  const tabs = [
    { id: 'business' as SettingsTab, name: t('manageShop.tabs.businessInfo'), icon: Building2 },
    { id: 'chat' as SettingsTab, name: t('manageShop.tabs.chatSettings'), icon: MessageSquare },
    { id: 'delivery' as SettingsTab, name: t('manageShop.tabs.deliverySettings'), icon: Truck },
    { id: 'payment' as SettingsTab, name: t('manageShop.tabs.paymentSettings'), icon: CreditCard },
    { id: 'priority' as SettingsTab, name: 'Platform Priority', icon: ArrowUpDown },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sub-navigation */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="px-4 md:px-8 py-4">
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 mb-4">{t('manageShop.title')}</h1>
          <nav className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    if (tab.id === 'chat') {
                      navigate('/app/manage-shop/chat-settings');
                    } else if (tab.id === 'delivery') {
                      navigate('/app/manage-shop/delivery-settings');
                    } else if (tab.id === 'payment') {
                      navigate('/app/manage-shop/payment-settings');
                    } else if (tab.id === 'priority') {
                      // Priority is rendered inline — no route change needed
                    } else {
                      navigate('/app/manage-shop');
                    }
                  }}
                  className={`flex items-center gap-2 px-3 md:px-4 py-2 rounded-lg text-sm transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.name}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Content Area */}
      <div>
        {activeTab === 'priority' ? <PlatformPrioritySettings /> : <Outlet />}
      </div>
    </div>
  );
}
