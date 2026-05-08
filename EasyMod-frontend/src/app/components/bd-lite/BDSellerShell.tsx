import React from 'react';
import { Outlet } from 'react-router-dom';
import { Store } from 'lucide-react';
import BottomNavBD from './BottomNavBD';

const BDSellerShell: React.FC = () => {
  return (
    <div className="flex flex-col min-h-screen bg-gray-50 pb-16">
      {/* Top App Bar - Mobile First */}
      <header className="fixed top-0 inset-x-0 h-14 bg-white border-b border-gray-200 z-50 flex items-center justify-between px-4">
        <div className="flex items-center gap-2 font-semibold text-blue-600">
          <div className="bg-blue-100 p-1.5 rounded-lg">
            <Store className="w-5 h-5 text-blue-600" />
          </div>
          <span>EasyMod BD</span>
        </div>
        {/* Shop Selector Dropdown */}
        <select className="text-sm bg-gray-100 border-none rounded-md px-2 py-1.5 outline-none focus:ring-2 focus:ring-blue-500 font-medium max-w-[150px] truncate">
          <option>Fashion Store Uttara</option>
          <option>Gadget BD</option>
        </select>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-md mx-auto mt-14 bg-white min-h-[calc(100vh-3.5rem-4rem)]">
        <Outlet />
      </main>

      {/* Fixed Bottom Navigation */}
      <BottomNavBD />
    </div>
  );
};

export default BDSellerShell;
