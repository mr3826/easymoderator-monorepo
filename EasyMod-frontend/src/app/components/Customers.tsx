import { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next';
import {
  Users,
  Search,
  X,
  Trash2,
  ChevronLeft,
  ChevronRight,
  UserPlus,
  Phone,
  Mail,
  MessageSquare,
  Calendar,
  Filter,
  ShieldAlert,
  ShieldOff,
  Loader2
} from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/api";
import type { Customer, CustomerFilters } from "@/api/types/customer";
import type { ChannelType } from "@/api/types/channel";

const channelConfig: Record<string, { icon: any; color: string; bgColor: string; labelKey: string }> = {
  facebook:  { icon: MessageSquare, color: "text-blue-600",   bgColor: "bg-blue-50",   labelKey: "customers.channels.facebook" },
  messenger: { icon: MessageSquare, color: "text-blue-500",   bgColor: "bg-blue-50",   labelKey: "customers.channels.messenger" },
  instagram: { icon: MessageSquare, color: "text-pink-600",   bgColor: "bg-pink-50",   labelKey: "customers.channels.instagram" },
  webchat:   { icon: MessageSquare, color: "text-purple-600", bgColor: "bg-purple-50", labelKey: "customers.channels.webchat" },
  telegram:  { icon: MessageSquare, color: "text-sky-600",    bgColor: "bg-sky-50",    labelKey: "customers.channels.telegram" },
  manual:    { icon: UserPlus,      color: "text-gray-600",   bgColor: "bg-gray-50",   labelKey: "customers.channels.manual" },
};

const REST_CHANNELS = ['facebook', 'telegram', 'webchat', 'manual'];

const PAGE_SIZE = 10;

// Safe first-character helper — name is nullable in the DB
const nameInitial = (name: string | null | undefined) =>
  (name ?? '?').charAt(0).toUpperCase();

export default function Customers() {
  const { t } = useTranslation();

  // Shop-wide stats (fetched once on mount, independent of filters)
  const [shopStats, setShopStats] = useState({ total: 0, channelCount: 0, manualCount: 0 });

  // Table data
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters and pagination
  const [searchQuery, setSearchQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);

  // UI state
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [togglingBlacklist, setTogglingBlacklist] = useState(false);

  const [newCustomer, setNewCustomer] = useState({
    name: "",
    number: "",
    email: "",
    channel: "" as const,
  });

  // ── Stats fetch — once on mount ────────────────────────────────────────────
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [allResult, manualResult] = await Promise.all([
          apiClient.getCustomers({ pageSize: 1 }),
          apiClient.getCustomers({ channel_type: 'manual' as ChannelType, pageSize: 1 }),
        ]);
        setShopStats({
          total: allResult.total,
          manualCount: manualResult.total,
          channelCount: allResult.total - manualResult.total,
        });
      } catch {
        // Stats are non-critical — fail silently
      }
    };
    fetchStats();
  }, []);

  // ── Table fetch — server-side, debounced search ───────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchCustomers();
    }, searchQuery ? 300 : 0);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, channelFilter, currentPage]);

  const fetchCustomers = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const filters: CustomerFilters = { page: currentPage, pageSize: PAGE_SIZE };
      if (searchQuery) filters.search = searchQuery;
      if (channelFilter !== 'all') filters.channel_type = channelFilter as ChannelType;

      const result = await apiClient.getCustomers(filters);
      setCustomers(result.data);
      setTableTotal(result.total);
    } catch (err: any) {
      setError(err.message || t('customers.errors.fetchFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  // Reset to page 1 when filters change
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  const handleChannelChange = (value: string) => {
    setChannelFilter(value);
    setCurrentPage(1);
  };

  const totalPages = Math.ceil(tableTotal / PAGE_SIZE);
  const startIndex = (currentPage - 1) * PAGE_SIZE + 1;
  const endIndex = Math.min(currentPage * PAGE_SIZE, tableTotal);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const handleCreateCustomer = async () => {
    if (!newCustomer.name || !newCustomer.number || !newCustomer.channel) {
      toast.error(t('customers.errors.requiredFields'));
      return;
    }
    try {
      setIsSubmitting(true);
      await apiClient.createCustomer({
        name: newCustomer.name,
        number: newCustomer.number,
        email: newCustomer.email || undefined,
        channel: newCustomer.channel,
      });
      setShowCreateCustomer(false);
      setNewCustomer({ name: "", number: "", email: "", channel: "" as const });
      toast.success(t('customers.success.created'));
      // Refresh table and stats
      fetchCustomers();
      setShopStats(prev => ({ ...prev, total: prev.total + 1 }));
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || err.response?.data?.message || t('customers.errors.createFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteCustomer = async (customerId: string) => {
    try {
      setIsSubmitting(true);
      await apiClient.deleteCustomer(customerId);
      setShowDeleteConfirm(null);
      if (selectedCustomer?.id === customerId) setSelectedCustomer(null);
      toast.success(t('customers.success.deleted'));
      fetchCustomers();
      setShopStats(prev => ({ ...prev, total: Math.max(0, prev.total - 1) }));
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t('customers.errors.deleteFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleBlacklist = async (customer: Customer) => {
    try {
      setTogglingBlacklist(true);
      const updated = customer.blacklisted
        ? await apiClient.unblacklistCustomer(customer.id)
        : await apiClient.blacklistCustomer(customer.id);
      setCustomers(prev => prev.map(c => c.id === customer.id ? updated : c));
      setSelectedCustomer(updated);
      toast.success(updated.blacklisted ? t('customers.success.blacklisted') : t('customers.success.unblacklisted'));
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t('customers.errors.blacklistFailed'));
    } finally {
      setTogglingBlacklist(false);
    }
  };

  const handleUpdateCustomer = async (customerId: string, updates: Partial<Customer>) => {
    try {
      setIsSubmitting(true);
      const updated = await apiClient.updateCustomer(customerId, updates);
      setCustomers(prev => prev.map(c => c.id === customerId ? updated : c));
      setSelectedCustomer(updated);
      toast.success(t('customers.success.updated'));
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t('customers.errors.updateFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">{t('customers.title')}</h1>
          <p className="text-gray-600 text-sm md:text-base">{t('customers.subtitle')}</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">{t('customers.totalCustomers')}</p>
                <p className="text-3xl font-bold text-gray-900">{shopStats.total}</p>
              </div>
              <div className="w-14 h-14 bg-blue-50 rounded-xl flex items-center justify-center">
                <Users className="w-7 h-7 text-blue-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">{t('customers.channelCustomers')}</p>
                <p className="text-3xl font-bold text-gray-900">{shopStats.channelCount}</p>
                <p className="text-xs text-gray-500 mt-1">{t('customers.channelCustomersHelper')}</p>
              </div>
              <div className="w-14 h-14 bg-green-50 rounded-xl flex items-center justify-center">
                <MessageSquare className="w-7 h-7 text-green-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">{t('customers.manualCustomers')}</p>
                <p className="text-3xl font-bold text-gray-900">{shopStats.manualCount}</p>
                <p className="text-xs text-gray-500 mt-1">{t('customers.manualCustomersHelper')}</p>
              </div>
              <div className="w-14 h-14 bg-purple-50 rounded-xl flex items-center justify-center">
                <UserPlus className="w-7 h-7 text-purple-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
            <X className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="flex-1 text-sm font-medium text-red-900">{error}</p>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Search and Filter Bar */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder={t('customers.searchPlaceholder')}
                className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div className="md:w-64">
              <select
                value={channelFilter}
                onChange={(e) => handleChannelChange(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none bg-white"
              >
                <option value="all">{t('customers.allChannels')}</option>
                {REST_CHANNELS.map((ch) => (
                  <option key={ch} value={ch}>
                    {t(channelConfig[ch]?.labelKey ?? `customers.channels.${ch}`, { defaultValue: ch })}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => setShowCreateCustomer(true)}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors whitespace-nowrap"
            >
              <UserPlus className="w-5 h-5" />
              {t('customers.addCustomer')}
            </button>
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-blue-600 mb-4" />
            <p className="text-gray-600">{t('customers.loading')}</p>
          </div>
        )}

        {/* Customer List */}
        {!isLoading && (
          <>
            {customers.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
                <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{t('customers.noCustomers')}</h3>
                <p className="text-gray-600">{t('customers.noCustomersHint')}</p>
              </div>
            ) : (
              <>
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-6">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">{t('customers.columns.customer')}</th>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">{t('customers.columns.contact')}</th>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">{t('customers.columns.channel')}</th>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">{t('customers.columns.rtoRisk')}</th>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">{t('customers.columns.created')}</th>
                          <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">{t('customers.columns.actions')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {customers.map((customer) => {
                          const cfg = channelConfig[customer.channel];
                          const ChannelIcon = cfg?.icon ?? MessageSquare;
                          return (
                            <tr key={customer.id} className="hover:bg-gray-50 transition-colors">
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-white font-semibold">
                                    {nameInitial(customer.name)}
                                  </div>
                                  <div>
                                    <p className="font-medium text-gray-900">{customer.name ?? t('customers.unknownName')}</p>
                                    <p className="text-sm text-gray-500">ID: {customer.id.slice(0, 8)}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2 text-sm text-gray-900">
                                    <Phone className="w-4 h-4 text-gray-400" />
                                    {customer.number ?? '—'}
                                  </div>
                                  {customer.email && (
                                    <div className="flex items-center gap-2 text-sm text-gray-600">
                                      <Mail className="w-4 h-4 text-gray-400" />
                                      {customer.email}
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg ${cfg?.bgColor ?? 'bg-gray-50'}`}>
                                  <ChannelIcon className={`w-4 h-4 ${cfg?.color ?? 'text-gray-600'}`} />
                                  <span className={`text-sm font-medium ${cfg?.color ?? 'text-gray-600'}`}>
                                    {t(cfg?.labelKey ?? `customers.channels.${customer.channel}`, { defaultValue: customer.channel })}
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                {customer.blacklisted ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-gray-900 text-white">
                                    <ShieldOff className="w-3 h-3" /> {t('customers.blacklisted')}
                                  </span>
                                ) : customer.rto_risk === 'high' ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                                    <ShieldAlert className="w-3 h-3" /> {t('customers.rtoHigh')}
                                  </span>
                                ) : customer.rto_risk === 'medium' ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                                    <ShieldAlert className="w-3 h-3" /> {t('customers.rtoMedium')}
                                  </span>
                                ) : customer.rto_risk === 'low' ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                                    <ShieldAlert className="w-3 h-3" /> {t('customers.rtoLow')}
                                  </span>
                                ) : (
                                  <span className="text-sm text-gray-400">—</span>
                                )}
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-2 text-sm text-gray-600">
                                  <Calendar className="w-4 h-4 text-gray-400" />
                                  {customer.created_at ? (
                                    new Date(customer.created_at).toLocaleDateString('en-US', {
                                      year: 'numeric', month: 'short', day: 'numeric'
                                    })
                                  ) : 'N/A'}
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => setSelectedCustomer(customer)}
                                    className="px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                  >
                                    {t('common.view')}
                                  </button>
                                  <button
                                    onClick={() => setShowDeleteConfirm(customer.id)}
                                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center justify-between">
                    <p className="text-sm text-gray-600">
                      {t('customers.pagination', { start: startIndex, end: endIndex, total: tableTotal })}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                        className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <span className="px-4 py-2 text-sm font-medium text-gray-700">
                        {currentPage} / {totalPages}
                      </span>
                      <button
                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        disabled={currentPage === totalPages}
                        className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Customer Detail Drawer */}
      {selectedCustomer && (
        <div className="fixed inset-0 bg-gray-900/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-2xl font-bold text-gray-900">{t('customers.detail.title')}</h2>
              <button
                onClick={() => setSelectedCustomer(null)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Avatar and Name */}
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-white text-2xl font-bold">
                  {nameInitial(selectedCustomer.name)}
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900">{selectedCustomer.name ?? t('customers.unknownName')}</h3>
                  <p className="text-sm text-gray-500">{t('customers.detail.id', { id: selectedCustomer.id.slice(0, 8) })}</p>
                  {selectedCustomer.blacklisted && (
                    <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-900 text-white">
                      <ShieldOff className="w-3 h-3" /> {t('customers.blacklisted')}
                    </span>
                  )}
                  {!selectedCustomer.blacklisted && selectedCustomer.rto_risk && (
                    <span className={`inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                      selectedCustomer.rto_risk === 'high' ? 'bg-red-100 text-red-700' :
                      selectedCustomer.rto_risk === 'medium' ? 'bg-amber-100 text-amber-700' :
                      'bg-green-100 text-green-700'
                    }`}>
                      <ShieldAlert className="w-3 h-3" /> {t('customers.detail.rtoRiskLabel', { level: selectedCustomer.rto_risk })}
                    </span>
                  )}
                </div>
              </div>

              {/* Contact Information */}
              <div className="space-y-4">
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-600 mb-2">
                    <Phone className="w-4 h-4" />
                    {t('customers.detail.phoneNumber')}
                  </label>
                  <p className="text-lg text-gray-900 pl-6">{selectedCustomer.number ?? '—'}</p>
                </div>

                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-600 mb-2">
                    <Mail className="w-4 h-4" />
                    {t('customers.detail.email')}
                  </label>
                  <p className="text-lg text-gray-900 pl-6">{selectedCustomer.email || t('customers.detail.notProvided')}</p>
                </div>

                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-600 mb-2">
                    <MessageSquare className="w-4 h-4" />
                    {t('customers.detail.channel')}
                  </label>
                  <div className="pl-6">
                    {(() => {
                      const cfg = channelConfig[selectedCustomer.channel];
                      const ChannelIcon = cfg?.icon ?? MessageSquare;
                      return (
                        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg ${cfg?.bgColor ?? 'bg-gray-50'}`}>
                          <ChannelIcon className={`w-5 h-5 ${cfg?.color ?? 'text-gray-600'}`} />
                          <span className={`text-base font-medium ${cfg?.color ?? 'text-gray-600'}`}>
                            {t(cfg?.labelKey ?? `customers.channels.${selectedCustomer.channel}`, { defaultValue: selectedCustomer.channel })}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-600 mb-2">
                    <Calendar className="w-4 h-4" />
                    {t('customers.detail.createdAt')}
                  </label>
                  <p className="text-base text-gray-900 pl-6">
                    {selectedCustomer.created_at ? (
                      new Date(selectedCustomer.created_at).toLocaleDateString('en-US', {
                        year: 'numeric', month: 'long', day: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                      })
                    ) : t('customers.detail.notAvailable')}
                  </p>
                </div>

                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-600 mb-2">
                    <Calendar className="w-4 h-4" />
                    {t('customers.detail.lastUpdated')}
                  </label>
                  <p className="text-base text-gray-900 pl-6">
                    {selectedCustomer.updated_at ? (
                      new Date(selectedCustomer.updated_at).toLocaleDateString('en-US', {
                        year: 'numeric', month: 'long', day: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                      })
                    ) : t('customers.detail.notAvailable')}
                  </p>
                </div>

                {/* RTO Shield Section */}
                {(selectedCustomer.rto_risk || selectedCustomer.rto_count !== undefined || selectedCustomer.blacklisted) && (
                  <div className="border border-gray-200 rounded-xl p-4 bg-gray-50">
                    <div className="flex items-center gap-2 mb-3">
                      <ShieldAlert className="w-4 h-4 text-gray-600" />
                      <span className="text-sm font-semibold text-gray-700">{t('customers.detail.rtoSection')}</span>
                    </div>
                    <div className="flex flex-wrap gap-3 text-sm">
                      {selectedCustomer.rto_risk && (
                        <div>
                          <span className="text-gray-500">{t('customers.detail.rtoRisk')} </span>
                          <span className={`font-semibold ${
                            selectedCustomer.rto_risk === 'high' ? 'text-red-600' :
                            selectedCustomer.rto_risk === 'medium' ? 'text-amber-600' :
                            'text-green-600'
                          }`}>
                            {selectedCustomer.rto_risk === 'high' ? t('customers.rtoHigh') :
                             selectedCustomer.rto_risk === 'medium' ? t('customers.rtoMedium') :
                             t('customers.rtoLow')}
                          </span>
                        </div>
                      )}
                      {selectedCustomer.rto_count !== undefined && (
                        <div>
                          <span className="text-gray-500">{t('customers.detail.rtoCount')} </span>
                          <span className="font-semibold text-gray-900">{selectedCustomer.rto_count}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Blacklist Toggle */}
                <div className="pt-2">
                  <button
                    onClick={() => handleToggleBlacklist(selectedCustomer)}
                    disabled={togglingBlacklist}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 ${
                      selectedCustomer.blacklisted
                        ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
                    }`}
                  >
                    {selectedCustomer.blacklisted ? (
                      <><ShieldOff className="w-4 h-4" /> {t('customers.detail.removeBlacklist')}</>
                    ) : (
                      <><ShieldAlert className="w-4 h-4" /> {t('customers.detail.addBlacklist')}</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Customer Modal */}
      {showCreateCustomer && (
        <div className="fixed inset-0 bg-gray-900/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-gray-900">{t('customers.addModal.title')}</h2>
              <button
                onClick={() => {
                  setShowCreateCustomer(false);
                  setNewCustomer({ name: "", number: "", email: "", channel: "" as const });
                }}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  {t('customers.addModal.name')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newCustomer.name}
                  onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder={t('customers.addModal.namePlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  {t('customers.addModal.phone')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  value={newCustomer.number}
                  onChange={(e) => setNewCustomer({ ...newCustomer, number: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder={t('customers.addModal.phonePlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">{t('customers.addModal.email')}</label>
                <input
                  type="email"
                  value={newCustomer.email}
                  onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder={t('customers.addModal.emailPlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  {t('customers.addModal.channel')} <span className="text-red-500">*</span>
                </label>
                <select
                  value={newCustomer.channel}
                  onChange={(e) => setNewCustomer({ ...newCustomer, channel: e.target.value as any })}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none bg-white"
                >
                  <option value="">{t('customers.addModal.channelPlaceholder')}</option>
                  {REST_CHANNELS.map((ch) => (
                    <option key={ch} value={ch}>
                      {t(channelConfig[ch]?.labelKey ?? `customers.channels.${ch}`, { defaultValue: ch })}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => {
                    setShowCreateCustomer(false);
                    setNewCustomer({ name: "", number: "", email: "", channel: "" as const });
                  }}
                  className="flex-1 px-6 py-3 border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 font-medium transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleCreateCustomer}
                  disabled={isSubmitting || !newCustomer.name || !newCustomer.number || !newCustomer.channel}
                  className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
                >
                  {isSubmitting ? t('customers.addModal.creating') : t('customers.addModal.createButton')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-gray-900/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-6 h-6 text-red-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2 text-center">{t('customers.deleteModal.title')}</h2>
            <p className="text-gray-600 mb-6 text-center">{t('customers.deleteModal.message')}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="flex-1 px-6 py-3 border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 font-medium transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleDeleteCustomer(showDeleteConfirm)}
                disabled={isSubmitting}
                className="flex-1 px-6 py-3 bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50 font-medium transition-colors"
              >
                {isSubmitting ? t('customers.deleteModal.deleting') : t('customers.deleteModal.deleteButton')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
