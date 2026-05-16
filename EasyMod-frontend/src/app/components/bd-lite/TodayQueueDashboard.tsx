import React, { useEffect, useState } from 'react';
import { MessageCircle, Box, CreditCard, AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react';
import { apiClient } from '@/api';

interface QueueData {
  unread_count: number;
  pending_payment_count: number;
  ready_to_dispatch_count: number;
  at_risk_orders: {
    id: string;
    customer_name: string;
    customer_phone: string;
    status: string;
    tracking_id: string | null;
  }[];
}

const TodayQueueDashboard: React.FC = () => {
  const [queue, setQueue] = useState<QueueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadQueue = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.getDashboardQueue();
      setQueue(data);
    } catch {
      setError('লোড হয়নি — আবার চেষ্টা করুন');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQueue();
    // Refresh every 2 minutes
    const interval = setInterval(loadQueue, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const getRtoLabel = (status: string) => {
    if (status === 'attempted') return 'ডেলিভারি হয়নি — হাব কল করুন';
    if (status === 'returned') return 'পার্সেল ফেরত আসছে (RTO)';
    return status;
  };

  return (
    <div className="p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900">আজকের কাজ</h1>
          <p className="text-sm text-gray-500 font-medium mt-1">যা এখনই করতে হবে</p>
        </div>
        <button
          onClick={loadQueue}
          disabled={loading}
          className="p-2 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          title="রিফ্রেশ করুন"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
          {error}
        </div>
      )}

      {/* Action Cards Grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* নতুন মেসেজ (Unread) */}
        <div className="bg-blue-50 border border-blue-100 p-4 rounded-2xl flex flex-col items-start gap-3 cursor-pointer active:scale-95 transition-transform">
          <div className="bg-blue-500 rounded-full p-2.5 text-white shadow-sm">
            <MessageCircle className="w-5 h-5" />
          </div>
          <div>
            <div className="text-3xl font-black text-gray-900">
              {loading ? '—' : queue?.unread_count ?? 0}
            </div>
            <div className="text-xs font-bold text-blue-700 uppercase mt-0.5">জবাব দিন</div>
            <div className="text-[11px] text-blue-500 mt-0.5">নতুন মেসেজ</div>
          </div>
        </div>

        {/* পেমেন্ট বাকি (Pending Payment) */}
        <div className="bg-orange-50 border border-orange-100 p-4 rounded-2xl flex flex-col items-start gap-3 cursor-pointer active:scale-95 transition-transform">
          <div className="bg-orange-500 rounded-full p-2.5 text-white shadow-sm">
            <CreditCard className="w-5 h-5" />
          </div>
          <div>
            <div className="text-3xl font-black text-gray-900">
              {loading ? '—' : queue?.pending_payment_count ?? 0}
            </div>
            <div className="text-[11px] font-bold text-orange-700 uppercase leading-snug mt-0.5">পেমেন্ট আসেনি</div>
            <div className="text-[10px] text-orange-400 mt-0.5">bKash কনফার্ম করুন</div>
          </div>
        </div>

        {/* কুরিয়ারে দিন (Ready to Dispatch) */}
        <div className="bg-purple-50 border border-purple-100 p-4 rounded-2xl flex flex-col items-start gap-3 col-span-2 cursor-pointer active:scale-95 transition-transform">
          <div className="flex items-center gap-4 w-full">
            <div className="bg-purple-500 rounded-full p-3 text-white shadow-sm shrink-0">
              <Box className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <div className="text-3xl font-black text-gray-900">
                {loading ? '—' : queue?.ready_to_dispatch_count ?? 0}
              </div>
              <div className="text-xs font-bold text-purple-700 uppercase mt-0.5">কুরিয়ারে দিন</div>
              <div className="text-[11px] text-purple-400 mt-0.5">প্যাক করে Steadfast / Pathao বুক করুন</div>
            </div>
            <div className="bg-purple-200/50 p-2 rounded-full shrink-0">
              <ArrowRight className="text-purple-600 w-5 h-5" strokeWidth={2.5} />
            </div>
          </div>
        </div>
      </div>

      {/* RTO Risk — only show if there are at-risk orders */}
      {!loading && queue && queue.at_risk_orders.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="p-3.5 border-b border-red-100 flex items-center gap-2 bg-red-100/50">
            <AlertTriangle className="w-5 h-5 text-red-600" strokeWidth={2.5} />
            <h3 className="text-sm font-bold text-red-900 uppercase tracking-wide">এখনই ব্যবস্থা নিন</h3>
            <span className="ml-auto bg-red-600 text-white text-[10px] px-2.5 py-1 rounded-full font-bold shadow-sm">
              {queue.at_risk_orders.length} টি অর্ডার ঝুঁকিতে
            </span>
          </div>
          <div className="divide-y divide-red-100/60">
            {queue.at_risk_orders.map(order => (
              <div key={order.id} className="p-4 flex gap-3 justify-between items-center text-sm cursor-pointer hover:bg-red-50/80 transition-colors">
                <div>
                  <div className="font-bold text-gray-900">{order.customer_name || order.id.slice(0, 8).toUpperCase()}</div>
                  <div className="text-xs text-gray-500 font-mono">{order.customer_phone}</div>
                  <div className="text-xs text-red-600 font-semibold mt-1">{getRtoLabel(order.status)}</div>
                </div>
                <a
                  href={`tel:${order.customer_phone}`}
                  className="text-[11px] uppercase tracking-wide bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg font-bold shadow-sm transition-colors shrink-0"
                >
                  কল করুন
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state when all clear */}
      {!loading && queue && queue.at_risk_orders.length === 0 &&
        queue.unread_count === 0 && queue.pending_payment_count === 0 && queue.ready_to_dispatch_count === 0 && (
        <div className="text-center py-8 text-gray-400">
          <div className="text-3xl mb-2">✅</div>
          <div className="font-bold text-gray-600">সব কাজ শেষ!</div>
          <div className="text-sm mt-1">আজকের কোনো পেন্ডিং কাজ নেই</div>
        </div>
      )}
    </div>
  );
};

export default TodayQueueDashboard;
