/**
 * BDOrders — Simplified mobile-first order list for BD f-commerce sellers.
 *
 * Reuses order API domain (getOrders, bookCourier) from the existing data layer.
 * One card per order. "Dispatch" is a primary hero button per card.
 * RTO risk badge uses order.rto_risk field (already on the Order type).
 * Bottom-sheet courier picker: Pathao / Steadfast / RedX.
 * Bengali default, English toggle via existing i18n.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Truck, RefreshCw, Globe, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { order as orderApi } from '@/api/domains';
import type { Order, CourierBookingPayload, DeliveryProvider } from '@/api/types/order';
import { Badge } from '../ui/badge';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '../ui/sheet';
import { cn } from '../ui/utils';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  draft:       'bg-gray-100 text-gray-700',
  confirmed:   'bg-blue-100 text-blue-700',
  processing:  'bg-yellow-100 text-yellow-700',
  completed:   'bg-green-100 text-green-700',
  cancelled:   'bg-red-100 text-red-700',
};

const COURIER_OPTIONS: { id: DeliveryProvider; labelBn: string; labelEn: string; etaBn: string; etaEn: string }[] = [
  { id: 'pathao',     labelBn: 'Pathao',     labelEn: 'Pathao',     etaBn: '১-২ দিন', etaEn: '1-2 days' },
  { id: 'steadfast',  labelBn: 'Steadfast',  labelEn: 'Steadfast',  etaBn: '২-৩ দিন', etaEn: '2-3 days' },
  { id: 'redx',       labelBn: 'RedX',       labelEn: 'RedX',       etaBn: '১-২ দিন', etaEn: '1-2 days' },
];

function formatBDT(amount: number, lang: string): string {
  return new Intl.NumberFormat(lang === 'bn' ? 'bn-BD' : 'en-US', {
    style: 'currency', currency: 'BDT', minimumFractionDigits: 0,
  }).format(amount);
}

// ──────────────────────────────────────────────
// Order card
// ──────────────────────────────────────────────

interface OrderCardProps {
  order: Order;
  lang: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onDispatch: (order: Order) => void;
}

function OrderCard({ order, lang, t, onDispatch }: OrderCardProps) {
  const rtoRisk = order.rto_risk;
  const isAlreadyDispatched = !!order.delivery_tracking_code;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-gray-900 text-sm">{order.customerName}</p>
          {order.customerPhone && (
            <p className="text-xs text-gray-500 mt-0.5">{order.customerPhone}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', STATUS_STYLES[order.status] ?? STATUS_STYLES.draft)}>
            {t(`orders.status${order.status.charAt(0).toUpperCase()}${order.status.slice(1)}`) || order.status}
          </span>
          {rtoRisk === 'high' && (
            <Badge className="text-[10px] bg-orange-50 text-orange-600 border-orange-200 gap-1 font-bn">
              <AlertTriangle className="w-3 h-3" />
              {lang === 'bn' ? 'RTO ঝুঁকি' : 'RTO Risk'}
            </Badge>
          )}
        </div>
      </div>

      {/* Items + total */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-500 font-bn">
          {t('orders.itemCount', { count: order.items.length })}
        </span>
        <span className="font-bold text-gray-900">{formatBDT(order.total, lang)}</span>
      </div>

      {/* Tracking info (if already dispatched) */}
      {isAlreadyDispatched && (
        <div className="text-xs text-gray-400 flex items-center gap-1">
          <Truck className="w-3 h-3" />
          <span>{order.delivery_provider} · {order.delivery_tracking_code}</span>
        </div>
      )}

      {/* Dispatch hero button */}
      <button
        type="button"
        onClick={() => onDispatch(order)}
        disabled={isAlreadyDispatched}
        className={cn(
          'w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-colors',
          isAlreadyDispatched
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
            : 'bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98]'
        )}
      >
        <Truck className="w-4 h-4" />
        <span className="font-bn">
          {isAlreadyDispatched
            ? (lang === 'bn' ? 'পাঠানো হয়েছে' : 'Dispatched')
            : (lang === 'bn' ? 'ডিসপ্যাচ করুন' : 'Dispatch')}
        </span>
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────
// Courier picker bottom-sheet
// ──────────────────────────────────────────────

interface CourierPickerProps {
  order: Order | null;
  open: boolean;
  onClose: () => void;
  onBooked: (trackingId: string, provider: string) => void;
  lang: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

function CourierPicker({ order, open, onClose, onBooked, lang, t }: CourierPickerProps) {
  const [selected, setSelected] = useState<DeliveryProvider>('steadfast');
  const [booking, setBooking] = useState(false);

  if (!order) return null;

  const handleBook = async () => {
    try {
      setBooking(true);
      const payload: CourierBookingPayload = {
        provider: selected,
        recipient_name: order.customerName,
        recipient_phone: order.customerPhone ?? '',
        recipient_address: order.deliveryAddress ?? '',
        cod_amount: order.total,
      };
      const result = await orderApi.bookCourier(order.id, payload);
      toast.success(t('courier.bookingSuccess', { trackingId: result.tracking_id }));
      onBooked(result.tracking_id, result.provider);
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      toast.error(msg ?? t('courier.errors.bookingFailed'));
    } finally {
      setBooking(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-8">
        <SheetHeader className="mb-4">
          <SheetTitle className="font-bn text-base">
            {lang === 'bn' ? 'কুরিয়ার বেছে নিন' : t('courier.modalTitle')}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-3">
          {COURIER_OPTIONS.map(courier => (
            <button
              key={courier.id}
              type="button"
              onClick={() => setSelected(courier.id)}
              className={cn(
                'w-full flex items-center justify-between rounded-xl border p-4 text-left transition-colors',
                selected === courier.id
                  ? 'border-primary bg-primary/5'
                  : 'border-gray-100 hover:border-gray-200'
              )}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                  <Truck className="w-5 h-5 text-gray-600" />
                </div>
                <div>
                  <p className="font-semibold text-sm text-gray-900">
                    {lang === 'bn' ? courier.labelBn : courier.labelEn}
                  </p>
                  <p className="text-xs text-gray-500 font-bn">
                    {lang === 'bn' ? `ETA: ${courier.etaBn}` : `ETA: ${courier.etaEn}`}
                  </p>
                </div>
              </div>
              {selected === courier.id && (
                <div className="w-5 h-5 rounded-full border-2 border-primary bg-primary/10 flex items-center justify-center">
                  <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                </div>
              )}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={handleBook}
          disabled={booking}
          className="mt-5 w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60 font-bn"
        >
          <Truck className="w-4 h-4" />
          {booking
            ? (lang === 'bn' ? 'বুক হচ্ছে...' : 'Booking...')
            : (lang === 'bn' ? 'কুরিয়ার বুক করুন' : t('courier.bookButton'))}
        </button>
      </SheetContent>
    </Sheet>
  );
}

// ──────────────────────────────────────────────
// Main BDOrders
// ──────────────────────────────────────────────

export default function BDOrders() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dispatchTarget, setDispatchTarget] = useState<Order | null>(null);
  const [courierOpen, setCourierOpen] = useState(false);

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const list = await orderApi.getOrders({ sort: '-createdAt', limit: 50 });
      setOrders(list);
    } catch {
      setError(lang === 'bn' ? 'অর্ডার লোড করতে ব্যর্থ' : 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, [lang]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const toggleLang = () => i18n.changeLanguage(lang === 'bn' ? 'en' : 'bn');

  const handleDispatch = useCallback((order: Order) => {
    setDispatchTarget(order);
    setCourierOpen(true);
  }, []);

  const handleBooked = useCallback((trackingId: string, provider: string) => {
    setOrders(prev =>
      prev.map(o =>
        o.id === dispatchTarget?.id
          ? { ...o, delivery_tracking_code: trackingId, delivery_provider: provider }
          : o
      )
    );
  }, [dispatchTarget]);

  const pendingOrders = useMemo(
    () => orders.filter(o => o.status !== 'completed' && o.status !== 'cancelled'),
    [orders]
  );
  const doneOrders = useMemo(
    () => orders.filter(o => o.status === 'completed' || o.status === 'cancelled'),
    [orders]
  );

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem-4rem)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white sticky top-0 z-10">
        <h1 className="font-bold text-base text-gray-900 font-bn">
          {lang === 'bn' ? 'অর্ডার' : t('orders.title')}
        </h1>
        <div className="flex items-center gap-2">
          <button type="button" onClick={toggleLang} title="Switch language"
            className="text-gray-400 hover:text-blue-600 transition-colors">
            <Globe className="w-4 h-4" />
          </button>
          <button type="button" onClick={fetchOrders} title="Refresh"
            className="text-gray-400 hover:text-blue-600 transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-gray-50">
        {loading && (
          <div className="text-center text-sm text-gray-400 py-12 font-bn">
            {lang === 'bn' ? 'লোড হচ্ছে...' : t('common.loading')}
          </div>
        )}
        {!loading && error && (
          <div className="text-center text-sm text-red-500 py-12 font-bn">{error}</div>
        )}
        {!loading && !error && orders.length === 0 && (
          <div className="text-center text-sm text-gray-400 py-12 font-bn">
            {lang === 'bn' ? 'কোনো অর্ডার নেই' : 'No orders found'}
          </div>
        )}
        {!loading && pendingOrders.length > 0 && (
          <>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide font-bn">
              {lang === 'bn' ? 'সক্রিয় অর্ডার' : 'Active'}
            </p>
            {pendingOrders.map(order => (
              <OrderCard key={order.id} order={order} lang={lang} t={t} onDispatch={handleDispatch} />
            ))}
          </>
        )}
        {!loading && doneOrders.length > 0 && (
          <>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mt-2 font-bn">
              {lang === 'bn' ? 'সম্পন্ন / বাতিল' : 'Completed / Cancelled'}
            </p>
            {doneOrders.map(order => (
              <OrderCard key={order.id} order={order} lang={lang} t={t} onDispatch={handleDispatch} />
            ))}
          </>
        )}
      </div>

      {/* Courier picker bottom-sheet */}
      <CourierPicker
        order={dispatchTarget}
        open={courierOpen}
        onClose={() => setCourierOpen(false)}
        onBooked={handleBooked}
        lang={lang}
        t={t}
      />
    </div>
  );
}
