import { useState } from "react";
import { Loader2, Truck, X } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/api";
import type { Order, CourierBookingPayload } from "@/api/types/order";
import { useTranslation } from "react-i18next";

interface Props {
  order: Order;
  onClose: () => void;
  onBooked: (trackingId: string, provider: string) => void;
}

export default function CourierBookingModal({ order, onClose, onBooked }: Props) {
  const { t } = useTranslation();
  const [provider, setProvider] = useState<'pathao' | 'steadfast' | 'redx'>('steadfast');
  const [recipientName, setRecipientName] = useState(order.customerName);
  const [recipientPhone, setRecipientPhone] = useState(order.customerPhone || '');
  const [recipientAddress, setRecipientAddress] = useState(order.deliveryAddress || '');
  const [codAmount, setCodAmount] = useState(order.total);
  const [itemDescription, setItemDescription] = useState(
    order.items.map((i) => `${i.productName} x${i.quantity}`).join(', ')
  );
  const [booking, setBooking] = useState(false);

  const handleBook = async () => {
    if (!recipientName.trim() || !recipientPhone.trim() || !recipientAddress.trim()) {
      toast.error(t('courier.errors.fieldsRequired'));
      return;
    }
    try {
      setBooking(true);
      const payload: CourierBookingPayload = {
        provider,
        recipient_name: recipientName,
        recipient_phone: recipientPhone,
        recipient_address: recipientAddress,
        cod_amount: codAmount,
        item_description: itemDescription || undefined,
      };
      const result = await apiClient.bookCourier(order.id, payload);
      toast.success(t('courier.bookingSuccess', { trackingId: result.tracking_id }));
      onBooked(result.tracking_id, result.provider);
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || t('courier.errors.bookingFailed'));
    } finally {
      setBooking(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-green-600" />
            <h2 className="text-lg font-semibold text-gray-900">{t('courier.modalTitle')}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Provider Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">{t('courier.provider')}</label>
          <div className="grid grid-cols-3 gap-2">
            {(['pathao', 'steadfast', 'redx'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setProvider(p)}
                className={`py-2 px-3 rounded-lg border text-sm font-medium capitalize transition-colors ${
                  provider === p
                    ? 'bg-green-600 text-white border-green-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-green-500'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Recipient Info */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('courier.recipientName')}</label>
            <input
              type="text"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('courier.recipientPhone')}</label>
            <input
              type="tel"
              value={recipientPhone}
              onChange={(e) => setRecipientPhone(e.target.value)}
              placeholder="01XXXXXXXXX"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('courier.recipientAddress')}</label>
            <textarea
              value={recipientAddress}
              onChange={(e) => setRecipientAddress(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('courier.codAmount')} (৳)</label>
            <input
              type="number"
              value={codAmount}
              onChange={(e) => setCodAmount(Number(e.target.value))}
              min={0}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <p className="text-xs text-gray-400 mt-1">{t('courier.codNote')}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('courier.itemDescription')}</label>
            <input
              type="text"
              value={itemDescription}
              onChange={(e) => setItemDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
        </div>

        <div className="flex gap-3 justify-end pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleBook}
            disabled={booking}
            className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2 disabled:opacity-60"
          >
            {booking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
            {t('courier.bookButton')}
          </button>
        </div>
      </div>
    </div>
  );
}
