import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, MessageCircle, ShoppingBag, Settings } from 'lucide-react';

const BottomNavBD: React.FC = () => {
  const location = useLocation();
  
  const navItems = [
    { path: '/bd-lite', exact: true, icon: Home, label: 'Queue' },
    { path: '/bd-lite/inbox', icon: MessageCircle, label: 'Inbox' },
    { path: '/bd-lite/orders', icon: ShoppingBag, label: 'Orders' },
    { path: '/bd-lite/settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 z-50 h-16 pb-safe">
      <div className="flex justify-around items-center h-full max-w-md mx-auto px-2">
        {navItems.map((item) => {
          const isActive = item.exact 
            ? location.pathname === item.path 
            : location.pathname.startsWith(item.path);
            
          const Icon = item.icon;
          
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center justify-center w-16 gap-1 mt-1 ${
                isActive ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <Icon className={`w-[22px] h-[22px] ${isActive ? 'fill-blue-50 stroke-blue-600' : ''}`} strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-[10px] font-semibold">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNavBD;
