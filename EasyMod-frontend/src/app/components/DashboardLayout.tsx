import { Link, Outlet, useLocation } from "react-router-dom";
import ConversationAlertBanner from './ConversationAlertBanner';
import {
  Home, MessageCircle, Grid3X3, ShoppingBag,
  Store, LogOut,
  CreditCard, Bell, ChevronLeft, ChevronRight,
  ChevronDown,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import OnboardingWizard from "./OnboardingWizard";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../features/auth/AuthProvider";
import LanguageToggle from "./LanguageToggle";

const appBasePath = '/app';

export default function DashboardLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const navigation = [
    { name: 'আজকের অবস্থা', path: appBasePath, icon: Home },
    { name: 'অর্ডারসমূহ', path: `${appBasePath}/orders`, icon: ShoppingBag },
    { name: 'বার্তা', path: `${appBasePath}/inbox`, icon: MessageCircle },
    { name: 'পণ্যসমূহ', path: `${appBasePath}/products`, icon: Grid3X3 },
    { name: 'সেটিংস', path: `${appBasePath}/manage-shop`, icon: Store },
  ];

  const { user, currentShop, logout } = useAuth();

  const [collapsed, setCollapsed] = useState(false);
  const [showShopPanel, setShowShopPanel] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (!currentShop?.id) return;
    const done = localStorage.getItem(`onboarding_done_${currentShop.id}`);
    if (!done && !currentShop.settings?.onboarding_completed) {
      setShowOnboarding(true);
    } else {
      setShowOnboarding(false);
    }
  }, [currentShop?.id, currentShop?.settings?.onboarding_completed]);

  const handleOnboardingComplete = () => {
    if (currentShop?.id) {
      localStorage.setItem(`onboarding_done_${currentShop.id}`, '1');
    }
    setShowOnboarding(false);
  };

  const activeShopName = currentShop?.shop_name || currentShop?.unique_code || currentShop?.id;

  // Derive page title from current route
  const activeNav = navigation.find(item =>
    item.path === location.pathname ||
    (item.path !== appBasePath && location.pathname.startsWith(item.path))
  );
  const pageTitle = activeNav?.name ?? 'Easy Moderator';

  const handleLogout = async () => {
    await logout();
    setShowShopPanel(false);
    navigate('/signin');
  };

  const sidebarW = collapsed ? 'md:w-16' : 'md:w-64';
  const mainML = collapsed ? 'md:ml-16' : 'md:ml-64';

  return (
    <div className="min-h-screen bg-gray-50 flex">

      {/* ─── Sidebar ─────────────────────────────────────────────────── */}
      <aside
        className={`${sidebarW} hidden md:flex bg-white border-r border-gray-200 fixed inset-y-0 left-0 flex-col transition-all duration-200 z-30`}
      >
        {/* Logo */}
        <div className="h-14 flex items-center px-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg shrink-0 flex items-center justify-center">
              <span className="text-white text-xs font-bold">EM</span>
            </div>
            {!collapsed && (
              <span className="text-base font-bold text-gray-900 whitespace-nowrap">Easy Moderator</span>
            )}
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive =
              location.pathname === item.path ||
              (item.path !== appBasePath && location.pathname.startsWith(item.path));

            return (
              <Link
                key={item.path}
                to={item.path}
                aria-label={collapsed ? item.name : undefined}
                title={collapsed ? item.name : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors group relative ${
                  isActive
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                {!collapsed && <span className="text-sm font-medium">{item.name}</span>}
                {/* Active indicator */}
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-blue-600 rounded-r-full" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer: language + privacy */}
        {!collapsed && (
          <div className="px-4 pb-2 flex items-center justify-between shrink-0">
            <a
              href="/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-400 hover:text-gray-600 hover:underline"
            >
              {t('common.privacyPolicy')}
            </a>
            <LanguageToggle variant="dark" />
          </div>
        )}

        {/* Collapse toggle button */}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="shrink-0 mx-2 mb-2 flex items-center justify-center gap-2 py-2 rounded-lg text-gray-400 hover:bg-gray-50 hover:text-gray-700 transition-colors text-xs"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </aside>

      {/* ─── Main area ───────────────────────────────────────────────── */}
      <div className={`flex-1 ${mainML} transition-all duration-200 flex flex-col h-screen`}>

        {/* ─── Sticky AppBar ─────────────────────────────────────────── */}
        <header className="sticky top-0 z-20 h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-4 shrink-0">
          {/* Page title */}
          <h1 className="text-sm font-semibold text-gray-800 flex-1 truncate">{pageTitle}</h1>

          {/* Notifications */}
          <button aria-label="Notifications" className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors">
            <Bell className="w-5 h-5" />
          </button>

          {/* Account menu */}
          <div className="relative">
            <button
              onClick={() => setShowShopPanel(p => !p)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <span className="font-medium truncate max-w-[140px]">{activeShopName || user?.full_name || user?.email || 'Shop'}</span>
              <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            </button>

            {showShopPanel && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowShopPanel(false)} />
                <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-xl border border-gray-200 shadow-lg z-50 overflow-hidden">
                  {/* User info header */}
                  <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                    <p className="text-xs font-semibold text-gray-900 truncate">{user?.full_name || user?.email || 'Account'}</p>
                    {user?.full_name && <p className="text-xs text-gray-500 truncate">{user?.email}</p>}
                  </div>
                  {/* Navigation links */}
                  <div className="py-1">
                    <button
                      onClick={() => { setShowShopPanel(false); navigate(`${appBasePath}/manage-shop`); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <Store className="w-4 h-4 text-gray-400" />
                      শপ সেটিংস
                    </button>
                    <button
                      onClick={() => { setShowShopPanel(false); navigate(`${appBasePath}/subscription`); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <CreditCard className="w-4 h-4 text-gray-400" />
                      সাবস্ক্রিপশন
                    </button>
                  </div>
                  {/* Logout */}
                  <div className="border-t border-gray-100 py-1">
                    <button
                      onClick={() => { setShowShopPanel(false); handleLogout(); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      {t('dashboard.logoutTitle')}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </header>

        {/* ─── Page content ──────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
          <ConversationAlertBanner />
          <Outlet />
        </main>
      </div>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2">
        <ul className="grid grid-cols-5 gap-1">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive =
              location.pathname === item.path ||
              (item.path !== appBasePath && location.pathname.startsWith(item.path));

            return (
              <li key={`mobile-${item.path}`}>
                <Link
                  to={item.path}
                  className={`flex min-h-12 flex-col items-center justify-center rounded-lg px-1 text-[11px] font-semibold transition-colors ${
                    isActive ? 'bg-blue-50 text-blue-600' : 'text-gray-600'
                  }`}
                >
                  <Icon className="mb-1 h-4 w-4" />
                  <span className="leading-none">{item.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ─── Onboarding Wizard ────────────────────────────────────── */}
      {showOnboarding && (
        <OnboardingWizard onComplete={handleOnboardingComplete} />
      )}


    </div>
  );
}
