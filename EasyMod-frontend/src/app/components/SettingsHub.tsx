import { Link } from "react-router-dom";
import { Building2, MessageSquare, Truck, CreditCard, ChevronRight } from "lucide-react";

const items = [
  {
    name: 'ব্যবসার তথ্য',
    description: 'নাম, ঠিকানা, লোগো ও অপারেটিং বিবরণ',
    path: '/app/manage-shop/business-info',
    icon: Building2,
    color: 'text-blue-600 bg-blue-50',
  },
  {
    name: 'চ্যাট সেটিংস',
    description: 'AI উত্তরের আচরণ ও গ্রিটিং কাস্টমাইজ করুন',
    path: '/app/manage-shop/chat-settings',
    icon: MessageSquare,
    color: 'text-purple-600 bg-purple-50',
  },
  {
    name: 'ডেলিভারি সেটিংস',
    description: 'কুরিয়ার, ডেলিভারি চার্জ ও জোন কনফিগার করুন',
    path: '/app/manage-shop/delivery-settings',
    icon: Truck,
    color: 'text-emerald-600 bg-emerald-50',
  },
  {
    name: 'পেমেন্ট সেটিংস',
    description: 'পেমেন্ট গেটওয়ে ও অগ্রিম পেমেন্ট নিয়ম',
    path: '/app/manage-shop/payment-settings',
    icon: CreditCard,
    color: 'text-amber-600 bg-amber-50',
  },
  {
    name: 'সাবস্ক্রিপশন',
    description: 'প্ল্যান, ব্যবহার ও ইনভয়েস ম্যানেজ করুন',
    path: '/app/subscription',
    icon: CreditCard,
    color: 'text-rose-600 bg-rose-50',
  },
];

export default function SettingsHub() {
  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">সেটিংস</h1>
        <p className="text-sm text-gray-500 mt-1">দোকানের কনফিগারেশন ম্যানেজ করুন</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.path}
              to={item.path}
              className="flex items-center gap-4 bg-white border border-gray-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm transition-all group"
            >
              <div className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 ${item.color}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-900">{item.name}</div>
                <div className="text-xs text-gray-500 mt-0.5 truncate">{item.description}</div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-500 shrink-0" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
