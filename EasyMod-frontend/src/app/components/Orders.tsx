import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, Clock, Loader2, Package as PackageIcon, XCircle, Eye, Plus, Search, Download, ChevronDown, X, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/api";
import type { Order, DeliveryAddress } from "@/api/types/order";
import type { Product } from "@/api/types/product";
import bdGeography from '../../data/bd-geography.json';
import CourierBookingModal from './CourierBookingModal';

const statusColors = {
  draft: 'bg-gray-100 text-gray-700',
  confirmed: 'bg-blue-100 text-blue-700',
  processing: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  sku?: string;
}

interface ManualOrder {
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  division: string;
  district: string;
  upazila: string;
  streetAddress: string;
  channel: string;
  items: OrderItem[];
  discount: number;
  tax: number;
  delivery: number;
  payment: string;
  notes: string;
  source: 'manual';
  createdBy: 'user';
}

const deriveZone = (divisionId: string, districtId: string): DeliveryAddress['zone'] => {
  if (divisionId === 'dhaka' && districtId === 'dhaka_city') return 'inside_dhaka';
  if (divisionId === 'dhaka') return 'sub_dhaka';
  return 'outside_dhaka';
};

export default function Orders() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedSearchQuery, setAppliedSearchQuery] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('last7days');
  const [searchQuery, setSearchQuery] = useState('');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showCreateOrder, setShowCreateOrder] = useState(false);
  const [showProductSelector, setShowProductSelector] = useState(false);
  const [detailNote, setDetailNote] = useState('');
  const [conversationSnippets, setConversationSnippets] = useState<string[]>([]);
  // Bug #14: inline product search — no separate modal needed
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [showCourierModal, setShowCourierModal] = useState(false);

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language === 'bn' ? 'bn-BD' : 'en-US', {
        style: 'currency',
        currency: 'BDT',
        minimumFractionDigits: 2,
      }),
    [i18n.language]
  );

  const formatCurrency = (value: number) => currencyFormatter.format(Number(value || 0));
  const formatDate = (value: string) => new Date(value).toLocaleString(i18n.language === 'bn' ? 'bn-BD' : 'en-US');

  const resolveDateRange = (value: string): { start_date?: string; end_date?: string } => {
    const now = new Date();

    if (value === 'today') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return { start_date: start.toISOString(), end_date: now.toISOString() };
    }

    if (value === 'last7days') {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { start_date: start.toISOString(), end_date: now.toISOString() };
    }

    if (value === 'last30days') {
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { start_date: start.toISOString(), end_date: now.toISOString() };
    }

    return {};
  };

  // Manual order form state
  const [manualOrder, setManualOrder] = useState<ManualOrder>({
    customerName: '',
    customerPhone: '',
    deliveryAddress: '',
    division: '',
    district: '',
    upazila: '',
    streetAddress: '',
    channel: 'manual',
    items: [],
    discount: 0,
    tax: 0,
    delivery: 0,
    payment: 'pending',
    notes: '',
    source: 'manual',
    createdBy: 'user',
  });

  // Products only need to load once — they don't change with order filters
  useEffect(() => {
    apiClient.getProducts()
      .then(setProducts)
      .catch((err: unknown) => console.error('Products load failed:', err));
  }, []);

  // Debounce search input so we don't fire an API call on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearchQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch orders whenever filters or debounced search change
  useEffect(() => {
    const controller = new AbortController();
    const fetchOrders = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const dateRange = resolveDateRange(dateFilter);
        const paymentStatus = filterStatus === 'completed' ? 'paid' : undefined;
        const fulfillmentStatus = filterStatus === 'cancelled' ? 'cancelled' : undefined;
        const fetchedOrders = await apiClient.getOrders({
          search: appliedSearchQuery || undefined,
          ...dateRange,
          payment_status: paymentStatus,
          fulfillment_status: fulfillmentStatus,
          page: 1,
          limit: 100,
        });
        if (!controller.signal.aborted) setOrders(fetchedOrders);
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        const e = err as { response?: { data?: { error?: { message?: string }; message?: string } } };
        setError(e?.response?.data?.error?.message ?? e?.response?.data?.message ?? t('orders.errors.loadFailed'));
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };
    fetchOrders();
    return () => controller.abort();
  }, [dateFilter, appliedSearchQuery, filterStatus]);

  useEffect(() => {
    const loadConversationSnippet = async () => {
      if (!selectedOrder?.customerName) {
        setConversationSnippets([]);
        return;
      }
      try {
        const list = await apiClient.getConversations({ search: selectedOrder.customerName, limit: 1 });
        const firstConv = list.conversations?.[0];
        if (!firstConv) {
          setConversationSnippets([]);
          return;
        }
        const messagesResult = await apiClient.getMessages(firstConv.id, { page: 1, limit: 3 });
        const snippets = (messagesResult.messages || [])
          .slice(-3)
          .map((msg) => msg.content)
          .filter(Boolean);
        setConversationSnippets(snippets);
      } catch (err: unknown) {
        console.error('Failed to load conversation snippet:', err);
        setConversationSnippets([]);
      }
    };

    loadConversationSnippet();
  }, [selectedOrder?.id, selectedOrder?.customerName]);

  const filteredOrders = orders.filter(order => {
    if (filterStatus === 'all') {
      return true;
    }

    return order.status === filterStatus;
  });

  const handleUpdateStatus = async (orderId: string, newStatus: Order['status']) => {
    try {
      const order = orders.find(o => o.id === orderId);
      if (newStatus === 'confirmed' && order?.rto_risk === 'high') {
        setError(t('orders.errors.highRTO'));
        return;
      }
      let updatedOrder: Order;
      if (newStatus === 'confirmed') {
        updatedOrder = await apiClient.confirmOrder(orderId);
      } else {
        updatedOrder = await apiClient.updateOrder(orderId, { status: newStatus });
      }

      setOrders(orders.map(o => 
        o.id === orderId ? updatedOrder : o
      ));
      if (selectedOrder?.id === orderId) {
        setSelectedOrder(updatedOrder);
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string }; message?: string } } };
      setError(e?.response?.data?.error?.message ?? e?.response?.data?.message ?? t('orders.errors.updateStatus'));
    }
  };

  const handleSaveNote = async () => {
    if (!selectedOrder || !detailNote.trim()) return;
    try {
      await apiClient.updateOrder(selectedOrder.id, { note: detailNote });
      setDetailNote('');
      toast.success('নোট সফলভাবে সংরক্ষণ হয়েছে');
    } catch (err: unknown) {
      console.error('Failed to save note:', err);
      toast.error(t('orders.errors.updateStatus'));
    }
  };

  const buildCsv = (rows: Record<string, string | number>[]) => {
    const headers = Object.keys(rows[0] || {});
    const escapeCsv = (value: string | number) => {
      const text = String(value ?? '');
      if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    };

    const lines = [headers.join(',')];
    rows.forEach((row) => {
      lines.push(headers.map((header) => escapeCsv(row[header] ?? '')).join(','));
    });

    return lines.join('\n');
  };

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleExport = (format: 'csv' | 'excel') => {
    if (orders.length === 0) {
      toast.error(t('orders.errors.noExportData'));
      setShowExportMenu(false);
      return;
    }

    if (format === 'excel') {
      toast.info(t('orders.errors.csvFallback'));
    }

    const rows = orders.map((order) => ({
      id: order.id,
      customer: order.customerName,
      total: order.total,
      status: order.status,
      channel: order.channel,
      createdAt: order.createdAt
    }));

    const csv = buildCsv(rows);
    downloadFile(csv, 'orders.csv', 'text/csv');
    setShowExportMenu(false);
  };

  const addProductToOrder = (product: Product, quantity: number = 1) => {
    const existingItem = manualOrder.items.find(item => item.productId === product.id);
    if (existingItem) {
      setManualOrder({
        ...manualOrder,
        items: manualOrder.items.map(item =>
          item.productId === product.id
            ? { ...item, quantity: item.quantity + quantity }
            : item
        )
      });
    } else {
      setManualOrder({
        ...manualOrder,
        items: [
          ...manualOrder.items,
          {
            productId: product.id,
            productName: product.name,
            quantity,
            price: product.price,
            sku: product.sku,
          }
        ]
      });
    }
    setShowProductSelector(false);
  };

  const removeProductFromOrder = (productId: string) => {
    setManualOrder({
      ...manualOrder,
      items: manualOrder.items.filter(item => item.productId !== productId)
    });
  };

  const updateProductQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeProductFromOrder(productId);
      return;
    }
    setManualOrder({
      ...manualOrder,
      items: manualOrder.items.map(item =>
        item.productId === productId ? { ...item, quantity } : item
      )
    });
  };

  const calculateSubtotal = () => {
    return manualOrder.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  };

  const calculateTotal = () => {
    const subtotal = calculateSubtotal();
    return subtotal - manualOrder.discount + manualOrder.tax + manualOrder.delivery;
  };

  const handleCreateOrder = async () => {
    if (!manualOrder.customerName.trim()) { toast.error(t('orders.errors.nameRequired')); return; }
    if (!manualOrder.customerPhone.trim()) { toast.error(t('orders.errors.phoneRequired')); return; }
    if (!manualOrder.division || !manualOrder.district || !manualOrder.upazila || !manualOrder.streetAddress.trim()) {
      toast.error(t('orders.errors.addressRequired')); return;
    }
    if (manualOrder.items.length === 0) { toast.error(t('orders.errors.itemRequired')); return; }

    try {
      setIsCreating(true);

      // Transform frontend order data to backend format
      const selectedDivision = bdGeography.divisions.find((d) => d.id === manualOrder.division);
      const selectedDistrict = selectedDivision?.districts.find((d) => d.id === manualOrder.district);
      const structuredAddress: DeliveryAddress = {
        division: selectedDivision?.name || manualOrder.division,
        district: selectedDistrict?.name || manualOrder.district,
        upazila: manualOrder.upazila,
        street_address: manualOrder.streetAddress,
        zone: deriveZone(manualOrder.division, manualOrder.district),
      };
      const orderData = {
        customer_name: manualOrder.customerName,
        customer_phone: manualOrder.customerPhone,
        delivery_address: structuredAddress,
        channel: manualOrder.channel,
        items: manualOrder.items.map(item => ({
          product_id: item.productId,
          quantity: item.quantity,
          price: item.price
        })),
        discount: manualOrder.discount,
        tax: manualOrder.tax,
        delivery_fee: manualOrder.delivery,
        payment_status: manualOrder.payment,
        note: manualOrder.notes
      };

      const newOrder = await apiClient.createOrder(orderData);
      setOrders([newOrder, ...orders]);
      setShowCreateOrder(false);
      toast.success(t('orders.createModal.createButton'));
      setManualOrder({
        customerName: '',
        customerPhone: '',
        deliveryAddress: '',
        division: '',
        district: '',
        upazila: '',
        streetAddress: '',
        channel: 'manual',
        items: [],
        discount: 0,
        tax: 0,
        delivery: 0,
        payment: 'pending',
        notes: '',
        source: 'manual',
        createdBy: 'user',
      });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string }; message?: string } } };
      toast.error(e?.response?.data?.error?.message ?? e?.response?.data?.message ?? t('orders.errors.createFailed'));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{t('orders.title')}</h1>
          <p className="text-muted-foreground mt-1">{t('orders.subtitle')}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-card rounded-lg p-4 border border-border">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Clock className="w-4 h-4" />
            <span className="text-sm">{t('orders.statusDraft')}</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{orders.filter(o => o.status === 'draft').length}</p>
        </div>
        <div className="bg-card rounded-lg p-4 border border-border">
          <div className="flex items-center gap-2 text-blue-600 mb-2">
            <CheckCircle className="w-4 h-4" />
            <span className="text-sm">{t('orders.statusConfirmed')}</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{orders.filter(o => o.status === 'confirmed').length}</p>
        </div>
        <div className="bg-card rounded-lg p-4 border border-border">
          <div className="flex items-center gap-2 text-yellow-600 mb-2">
            <PackageIcon className="w-4 h-4" />
            <span className="text-sm">{t('orders.statusProcessing')}</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{orders.filter(o => o.status === 'processing').length}</p>
        </div>
        <div className="bg-card rounded-lg p-4 border border-border">
          <div className="flex items-center gap-2 text-green-600 mb-2">
            <CheckCircle className="w-4 h-4" />
            <span className="text-sm">{t('orders.statusCompleted')}</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{orders.filter(o => o.status === 'completed').length}</p>
        </div>
      </div>

      {/* Order Control Section */}
      <div className="bg-card rounded-lg border border-border p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          {/* Date Filter */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-foreground">{t('orders.filterDate')}</label>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="today">{t('orders.dateToday')}</option>
              <option value="last7days">{t('orders.dateLast7')}</option>
              <option value="last30days">{t('orders.dateLast30')}</option>
              <option value="custom">{t('orders.dateCustom')}</option>
            </select>
          </div>

          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('orders.searchPlaceholder')}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
          </div>

          {/* Export */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm"
            >
              <Download className="w-4 h-4" />
              {t('orders.export')}
              <ChevronDown className="w-4 h-4" />
            </button>
            {showExportMenu && (
              <>
                <div className="fixed inset-0 z-[9]" onClick={() => setShowExportMenu(false)} />
                <div className="absolute right-0 mt-2 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                <button
                  onClick={() => handleExport('csv')}
                  className="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm"
                >
                  {t('orders.exportCSV')}
                </button>
                <button
                  onClick={() => handleExport('excel')}
                  className="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm border-t border-gray-200"
                >
                  {t('orders.exportExcel')}
                </button>
              </div>
              </>
            )}
          </div>

          {/* Create Order */}
          <button
            onClick={() => setShowCreateOrder(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
          >
            <Plus className="w-4 h-4" />
            {t('orders.createOrder')}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card rounded-lg border border-border p-4 mb-6">
        <div className="flex gap-2 flex-wrap">
          {[
            { value: 'all', label: t('orders.statusAll') },
            { value: 'draft', label: t('orders.statusDraft') },
            { value: 'confirmed', label: t('orders.statusConfirmed') },
            { value: 'processing', label: t('orders.statusProcessing') },
            { value: 'completed', label: t('orders.statusCompleted') },
            { value: 'cancelled', label: t('orders.statusCancelled') },
          ].map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setFilterStatus(value)}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                filterStatus === value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Orders Cards */}
      <div className="space-y-3">
        {filteredOrders.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-10 text-center">
            <PackageIcon className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium text-muted-foreground">কোনো অর্ডার পাওয়া যায়নি।</p>
          </div>
        ) : (
          filteredOrders.map((order) => (
            <article key={order.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-bold text-card-foreground">{order.customerName}</p>
                  <p className="text-xs text-muted-foreground">#{order.id}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusColors[order.status]}`}>
                  {order.status}
                </span>
              </div>

              <p className="text-sm text-foreground">
                {order.items[0]?.productName || 'পণ্য উল্লেখ নেই'} × {order.items[0]?.quantity || 1} ·{' '}
                <span className="font-bold">{formatCurrency(order.total)}</span>
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-md bg-muted px-2 py-1">📍 {order.channel}</span>
                <span className="rounded-md bg-muted px-2 py-1">🕐 {formatDate(order.createdAt)}</span>
                {order.rto_risk === 'high' && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-1 font-semibold text-red-700">
                    <AlertTriangle className="h-3 w-3" /> {t('customers.highRTO')}
                  </span>
                )}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setSelectedOrder(order)}
                  className="min-h-12 rounded-xl border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-700"
                >
                  বিস্তারিত দেখুন
                </button>
                {order.delivery_tracking_code ? (
                  <a
                    href={`https://steadfast.com.bd/track?trackingCode=${order.delivery_tracking_code}`}
                    target="_blank"
                    rel="noreferrer"
                    className="min-h-12 rounded-xl bg-[#1DB954] px-3 text-sm font-semibold text-white flex items-center justify-center"
                  >
                    ট্র্যাক করুন
                  </a>
                ) : (
                  <button
                    onClick={() => { setSelectedOrder(order); }}
                    className="min-h-12 rounded-xl bg-blue-600 px-3 text-sm font-semibold text-white"
                  >
                    স্ট্যাটাস আপডেট
                  </button>
                )}
              </div>
            </article>
          ))
        )}
      </div>

      {/* Create Order Modal */}
      {showCreateOrder && (
        <div
          className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowCreateOrder(false); }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowCreateOrder(false); }}
        >
          <div className="bg-card rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between z-10">
              <h2 className="text-2xl font-bold text-card-foreground">{t('orders.createModal.title')}</h2>
              <button
                onClick={() => setShowCreateOrder(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Customer Info */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-3">{t('orders.createModal.customerSection')}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {t('orders.createModal.customerName')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={manualOrder.customerName}
                      onChange={(e) => setManualOrder({ ...manualOrder, customerName: e.target.value })}
                      placeholder={t('orders.createModal.customerNamePlaceholder')}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {t('orders.createModal.phone')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="tel"
                      value={manualOrder.customerPhone}
                      onChange={(e) => setManualOrder({ ...manualOrder, customerPhone: e.target.value })}
                      placeholder={t('orders.createModal.phonePlaceholder')}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">{t('orders.createModal.channel')}</label>
                    <select
                      value={manualOrder.channel}
                      onChange={(e) => setManualOrder({ ...manualOrder, channel: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="manual">{t('orders.createModal.channelManual')}</option>
                      <option value="facebook">{t('orders.createModal.channelFacebook')}</option>
                      <option value="webchat">{t('orders.createModal.channelWebChat')}</option>
                      <option value="telegram">{t('orders.createModal.channelTelegram')}</option>
                    </select>
                  </div>
                </div>

                {/* Delivery Address — structured BD geography */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('orders.createModal.address')} <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
                    <select
                      value={manualOrder.division}
                      onChange={(e) => setManualOrder({ ...manualOrder, division: e.target.value, district: '', upazila: '' })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    >
                      <option value="">{t('orders.form.division')}</option>
                      {bdGeography.divisions.map((div) => (
                        <option key={div.id} value={div.id}>{div.name} / {div.name_bn}</option>
                      ))}
                    </select>
                    <select
                      value={manualOrder.district}
                      onChange={(e) => setManualOrder({ ...manualOrder, district: e.target.value, upazila: '' })}
                      disabled={!manualOrder.division}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm disabled:bg-gray-100"
                    >
                      <option value="">{t('orders.form.district')}</option>
                      {bdGeography.divisions
                        .find((d) => d.id === manualOrder.division)
                        ?.districts.map((dist) => (
                          <option key={dist.id} value={dist.id}>{dist.name} / {dist.name_bn}</option>
                        ))}
                    </select>
                    <select
                      value={manualOrder.upazila}
                      onChange={(e) => setManualOrder({ ...manualOrder, upazila: e.target.value })}
                      disabled={!manualOrder.district}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm disabled:bg-gray-100"
                    >
                      <option value="">{t('orders.form.upazila')}</option>
                      {bdGeography.divisions
                        .find((d) => d.id === manualOrder.division)
                        ?.districts.find((d) => d.id === manualOrder.district)
                        ?.upazilas.map((upazila) => (
                          <option key={upazila} value={upazila}>{upazila}</option>
                        ))}
                    </select>
                  </div>
                  <input
                    type="text"
                    value={manualOrder.streetAddress}
                    onChange={(e) => setManualOrder({ ...manualOrder, streetAddress: e.target.value })}
                    placeholder={t('orders.form.streetAddress')}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                  {manualOrder.division && manualOrder.district && (
                    <p className="text-xs text-gray-500 mt-1">
                      Zone: <span className="font-medium text-blue-600">{deriveZone(manualOrder.division, manualOrder.district)?.replace(/_/g, ' ')}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* Products — Bug #14: inline search, no separate modal */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-3">{t('orders.createModal.productsSection')}</h3>

                {/* Inline product search */}
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search and add products…"
                    value={productSearchQuery}
                    onChange={(e) => setProductSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                  {/* Dropdown results */}
                  {productSearchQuery.trim().length >= 1 && (
                    <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto mt-1">
                      {products
                        .filter(p =>
                          p.name.toLowerCase().includes(productSearchQuery.toLowerCase()) ||
                          (p.sku || '').toLowerCase().includes(productSearchQuery.toLowerCase())
                        )
                        .slice(0, 8)
                        .map(product => (
                          <button
                            key={product.id}
                            type="button"
                            onClick={() => {
                              addProductToOrder(product);
                              setProductSearchQuery('');
                            }}
                            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-blue-50 text-left text-sm border-b border-gray-100 last:border-0"
                          >
                            <span className="font-medium text-gray-900 truncate">{product.name}</span>
                            <span className="ml-2 text-blue-700 font-semibold whitespace-nowrap">{formatCurrency(product.price)}</span>
                          </button>
                        ))
                      }
                      {products.filter(p =>
                        p.name.toLowerCase().includes(productSearchQuery.toLowerCase()) ||
                        (p.sku || '').toLowerCase().includes(productSearchQuery.toLowerCase())
                      ).length === 0 && (
                        <p className="px-4 py-3 text-sm text-gray-500">No products found</p>
                      )}
                    </div>
                  )}
                </div>

                {manualOrder.items.length === 0 ? (
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                    <PackageIcon className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-600">{t('orders.createModal.noProducts')}</p>
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-200">
                    {manualOrder.items.map((item, index) => (
                      <div key={index} className="p-4 flex items-center gap-4">
                        <div className="flex-1">
                          <p className="font-medium text-gray-900">{item.productName}</p>
                          <p className="text-sm text-gray-500">{t('orders.labels.sku')}: {item.sku} • {formatCurrency(item.price)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => updateProductQuantity(item.productId, item.quantity - 1)}
                            className="w-8 h-8 border border-gray-300 rounded hover:bg-gray-50"
                          >
                            -
                          </button>
                          <span className="w-12 text-center text-sm font-medium">{item.quantity}</span>
                          <button
                            onClick={() => updateProductQuantity(item.productId, item.quantity + 1)}
                            className="w-8 h-8 border border-gray-300 rounded hover:bg-gray-50"
                          >
                            +
                          </button>
                        </div>
                        <div className="w-24 text-right font-semibold text-gray-900">
                          {formatCurrency(item.price * item.quantity)}
                        </div>
                        <button
                          onClick={() => removeProductFromOrder(item.productId)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Order Summary */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-4">{t('orders.createModal.orderSummary')}</h3>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">{t('orders.createModal.subtotal')}:</span>
                    <span className="text-gray-900">{formatCurrency(calculateSubtotal())}</span>
                  </div>
                  <div className="flex justify-between text-sm items-center">
                    <span className="text-gray-600">{t('orders.createModal.discount')}:</span>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500">৳</span>
                      <input
                        type="number"
                        value={manualOrder.discount}
                        onChange={(e) => setManualOrder({ ...manualOrder, discount: parseFloat(e.target.value) || 0 })}
                        className="w-24 px-2 py-1 border border-gray-300 rounded text-right text-sm"
                        step="0.01"
                        min="0"
                      />
                    </div>
                  </div>
                  <div className="flex justify-between text-sm items-center">
                    <span className="text-gray-600">{t('orders.createModal.vat')}:</span>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500">৳</span>
                      <input
                        type="number"
                        value={manualOrder.tax}
                        onChange={(e) => setManualOrder({ ...manualOrder, tax: parseFloat(e.target.value) || 0 })}
                        className="w-24 px-2 py-1 border border-gray-300 rounded text-right text-sm"
                        step="0.01"
                        min="0"
                      />
                    </div>
                  </div>
                  <div className="flex justify-between text-sm items-center">
                    <span className="text-gray-600">{t('orders.createModal.delivery')}:</span>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500">৳</span>
                      <input
                        type="number"
                        value={manualOrder.delivery}
                        onChange={(e) => setManualOrder({ ...manualOrder, delivery: parseFloat(e.target.value) || 0 })}
                        className="w-24 px-2 py-1 border border-gray-300 rounded text-right text-sm"
                        step="0.01"
                        min="0"
                      />
                    </div>
                  </div>
                  <div className="border-t border-gray-300 pt-3 flex justify-between font-bold">
                    <span className="text-gray-900">{t('orders.createModal.total')}:</span>
                    <span className="text-blue-600 text-lg">{formatCurrency(calculateTotal())}</span>
                  </div>
                </div>
              </div>

              {/* Payment & Notes */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('orders.createModal.paymentStatus')}</label>
                  <select
                    value={manualOrder.payment}
                    onChange={(e) => setManualOrder({ ...manualOrder, payment: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="pending">{t('orders.createModal.payPending')}</option>
                    <option value="paid">{t('orders.createModal.payPaid')}</option>
                    <option value="unpaid">{t('orders.createModal.payUnpaid')}</option>
                    <option value="refunded">{t('orders.createModal.payRefunded')}</option>
                    <option value="partially_paid">{t('orders.createModal.payPartial')}</option>
                  </select>
                  {(manualOrder.payment === 'unpaid' || manualOrder.payment === 'pending') && (
                    <p className="mt-1.5 flex items-center gap-1 text-xs text-amber-700">
                      <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                      {t('orders.createModal.rtoWarning')}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('orders.createModal.notes')}</label>
                  <input
                    type="text"
                    value={manualOrder.notes}
                    onChange={(e) => setManualOrder({ ...manualOrder, notes: e.target.value })}
                    placeholder={t('orders.createModal.notesPlaceholder')}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-gray-200 px-6 py-4 flex gap-3">
              <button
                onClick={() => setShowCreateOrder(false)}
                className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleCreateOrder}
                disabled={
                  isCreating ||
                  !manualOrder.customerName ||
                  !manualOrder.customerPhone ||
                  (!manualOrder.division || !manualOrder.district || !manualOrder.upazila || !manualOrder.streetAddress.trim()) ||
                  manualOrder.items.length === 0
                }
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreating && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('orders.createModal.createButton')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Product Selector Modal */}
      {showProductSelector && (
        <div
          className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-[60] p-4"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowProductSelector(false); }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowProductSelector(false); }}
        >
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">{t('orders.selectProduct.title')}</h3>
              <button
                onClick={() => setShowProductSelector(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-3">
                {products.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => addProductToOrder(product)}
                    className="w-full flex items-center gap-4 p-4 border border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors text-left"
                  >
                    <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                      <PackageIcon className="w-6 h-6 text-gray-600" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{product.name}</p>
                      <p className="text-sm text-gray-500">{t('orders.labels.sku')}: {product.sku} • {product.category}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-gray-900">{formatCurrency(product.price)}</p>
                      <p className="text-xs text-green-600">{product.stock ? t('orders.selectProduct.inStock') : t('orders.selectProduct.outOfStock')}</p>
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <p className="text-sm text-gray-700 mb-3 flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  {t('orders.selectProduct.createNew')}
                </p>
                <button
                  onClick={() => {
                    setShowProductSelector(false);
                    setShowCreateOrder(false);
                    navigate('/app/products/add');
                  }}
                  className="w-full px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  {t('orders.selectProduct.createButton')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Order Details Modal */}
      {selectedOrder && (
        <div
          className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4"
          onKeyDown={(e) => { if (e.key === 'Escape') setSelectedOrder(null); }}
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedOrder(null); }}
        >
          <div className="bg-white rounded-xl p-4 md:p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{t('orders.detailModal.title')}</h2>
                <p className="text-gray-600 mt-1">{selectedOrder.id}</p>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            {/* Customer Info */}
            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <h3 className="font-semibold text-gray-900 mb-3">{t('orders.detailModal.customerSection')}</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">{t('orders.detailModal.name')}:</span>
                  <span className="text-gray-900 font-medium">{selectedOrder.customerName}</span>
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  {selectedOrder.customerPhone ? (
                    <>
                      <a
                        href={`tel:${selectedOrder.customerPhone}`}
                        className="min-h-12 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700"
                      >
                        কল করুন
                      </a>
                    </>
                  ) : (
                    <span className="text-xs text-gray-500">গ্রাহকের নম্বর পাওয়া যায়নি</span>
                  )}
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">{t('orders.detailModal.channel')}:</span>
                  <span className="text-gray-900 font-medium capitalize">{selectedOrder.channel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">{t('orders.detailModal.created')}:</span>
                  <span className="text-gray-900 font-medium">
                    {formatDate(selectedOrder.createdAt)}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <h3 className="font-semibold text-gray-900 mb-3">ডেলিভারি ঠিকানা</h3>
              {selectedOrder.delivery_address ? (
                <div className="space-y-1 text-sm text-gray-700 mb-3">
                  <p>{selectedOrder.delivery_address.street_address}</p>
                  <p>{selectedOrder.delivery_address.upazila}, {selectedOrder.delivery_address.district}</p>
                  <p>{selectedOrder.delivery_address.division}</p>
                  {selectedOrder.delivery_address.zone && (
                    <span className="inline-block text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full mt-1">
                      Zone: {selectedOrder.delivery_address.zone.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-700 mb-3">{selectedOrder.deliveryAddress || 'ঠিকানা এখনো যোগ করা হয়নি'}</p>
              )}
              {selectedOrder.deliveryAddress && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedOrder.deliveryAddress)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-lg border border-gray-200 bg-white p-3 text-sm font-semibold text-blue-700"
                >
                  ম্যাপে দেখুন
                </a>
              )}
            </div>

            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <h3 className="font-semibold text-gray-900 mb-3">পেমেন্ট অবস্থা</h3>
              <p className="text-sm font-medium text-gray-700">{selectedOrder.payment_status || 'COD pending'}</p>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <h3 className="font-semibold text-gray-900 mb-3">কাস্টমার চ্যাট (শেষ ৩ বার্তা)</h3>
              {conversationSnippets.length === 0 ? (
                <p className="text-sm text-gray-500">কোনো চ্যাট snippet পাওয়া যায়নি।</p>
              ) : (
                <div className="space-y-2">
                  {conversationSnippets.map((line, idx) => (
                    <p key={`${selectedOrder.id}-msg-${idx}`} className="rounded-lg bg-white p-3 text-sm text-gray-700 border border-gray-200">
                      {line}
                    </p>
                  ))}
                </div>
              )}
            </div>

            {/* Order Meta Information */}
            <div className="bg-blue-50 rounded-lg p-4 mb-6 border border-blue-200">
              <h3 className="font-semibold text-gray-900 mb-3">{t('orders.detailModal.metaSection')}</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">{t('orders.detailModal.orderSource')}:</span>
                  <span className="text-gray-900 font-medium capitalize">{selectedOrder.channel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">{t('orders.detailModal.createdBy')}:</span>
                  <span className="text-gray-900 font-medium">
                    {selectedOrder.channel === 'manual' ? t('orders.detailModal.createdByManual') : t('orders.detailModal.createdByAI')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">{t('orders.detailModal.creationMethod')}:</span>
                  <span className="text-gray-900 font-medium">
                    {selectedOrder.channel === 'manual' ? t('orders.detailModal.methodManual') : t('orders.detailModal.methodAutomated')}
                  </span>
                </div>
              </div>
            </div>

            {/* Order Items */}
            <div className="mb-6">
              <h3 className="font-semibold text-gray-900 mb-3">{t('orders.detailModal.itemsSection')}</h3>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-200">
                {selectedOrder.items.map((item, index) => (
                  <div key={index} className="p-4 flex justify-between items-center">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{item.productName}</p>
                      <p className="text-sm text-gray-500">{t('orders.detailModal.quantity')}: {item.quantity}</p>
                    </div>
                    <p className="text-gray-900 font-semibold">
                      {formatCurrency(item.price * item.quantity)}
                    </p>
                  </div>
                ))}
              </div>
              
              <div className="mt-4 flex justify-between items-center text-lg font-bold">
                <span>{t('orders.detailModal.total')}:</span>
                <span className="text-blue-600">{formatCurrency(selectedOrder.total)}</span>
              </div>
            </div>

            {/* Order Status */}
            <div className="mb-6">
              <h3 className="font-semibold text-gray-900 mb-3">{t('orders.detailModal.updateStatus')}</h3>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: 'confirmed' as Order['status'], label: t('orders.statusConfirmed') },
                  { value: 'processing' as Order['status'], label: t('orders.statusProcessing') },
                  { value: 'completed' as Order['status'], label: t('orders.statusCompleted') },
                  { value: 'cancelled' as Order['status'], label: t('orders.statusCancelled') },
                ]).map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => handleUpdateStatus(selectedOrder.id, value)}
                    disabled={selectedOrder.status === value}
                    className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                      selectedOrder.status === value
                        ? statusColors[value] + ' opacity-50 cursor-not-allowed'
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-6">
              <h3 className="font-semibold text-gray-900 mb-3">নোট</h3>
              <textarea
                value={detailNote}
                onChange={(e) => setDetailNote(e.target.value)}
                rows={3}
                placeholder="এখানে অর্ডার নোট লিখুন"
                className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleSaveNote}
                className="flex-1 min-w-[120px] px-4 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-black text-sm"
              >
                নোট সংরক্ষণ
              </button>
              <button
                onClick={() => setShowCourierModal(true)}
                disabled={!!selectedOrder.delivery_tracking_code}
                className="flex-1 min-w-[120px] px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                {selectedOrder.delivery_tracking_code ? `ID: ${selectedOrder.delivery_tracking_code}` : 'কুরিয়ার বুক'}
              </button>
              {selectedOrder.status === 'draft' && (
                <button
                  onClick={() => handleUpdateStatus(selectedOrder.id, 'confirmed')}
                  className="flex-1 min-w-[120px] px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                >
                  {t('orders.detailModal.confirmOrder')}
                </button>
              )}
              {selectedOrder.status !== 'completed' && (
                <button
                  onClick={() => handleUpdateStatus(selectedOrder.id, 'cancelled')}
                  className="flex-1 min-w-[120px] px-4 py-2.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 text-sm"
                >
                  বাতিল করুন
                </button>
              )}
              <button
                onClick={() => setSelectedOrder(null)}
                className="w-full px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm"
              >
                {t('orders.detailModal.close')}
              </button>
            </div>
          </div>
        </div>
      )}
      {showCourierModal && selectedOrder && (
        <CourierBookingModal
          order={selectedOrder}
          onClose={() => setShowCourierModal(false)}
          onBooked={(trackingId, provider) => {
            const updated = { ...selectedOrder, delivery_tracking_code: trackingId, delivery_provider: provider };
            setSelectedOrder(updated);
            setOrders(prev => prev.map(o => o.id === selectedOrder.id ? updated : o));
          }}
        />
      )}
    </div>
  );
}
