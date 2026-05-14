import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Truck, Check, X, AlertCircle, Loader2, Power, TestTube } from 'lucide-react';
import { apiClient } from '@/api';
import type { 
  DeliveryProvider, 
  DeliveryProviderStatus, 
  DeliveryShopSettings,
  PathaoCredentials, 
  SteadfastCredentials,
  RedxCredentials
} from '@/api/types/order';

interface ProviderConfig {
  provider: DeliveryProvider;
  display_name: string;
  description: string;
  logo: string;
  fields: {
    name: keyof PathaoCredentials | keyof SteadfastCredentials | keyof RedxCredentials;
    label: string;
    type: 'text' | 'password' | 'email';
    placeholder: string;
    required: boolean;
  }[];
}

const PROVIDER_CONFIGS: ProviderConfig[] = [
  {
    provider: 'pathao',
    display_name: 'Pathao Courier',
    description: 'Fast and reliable delivery across Bangladesh',
    logo: '🚚',
    fields: [
      {
        name: 'client_id',
        label: 'Client ID',
        type: 'text',
        placeholder: 'Enter your Pathao Client ID',
        required: true
      },
      {
        name: 'client_secret',
        label: 'Client Secret',
        type: 'password',
        placeholder: 'Enter your Pathao Client Secret',
        required: true
      },
      {
        name: 'username',
        label: 'Username (Email)',
        type: 'email',
        placeholder: 'merchant@example.com',
        required: true
      },
      {
        name: 'password',
        label: 'Password',
        type: 'password',
        placeholder: 'Enter your Pathao account password',
        required: true
      }
    ]
  },
  {
    provider: 'steadfast',
    display_name: 'Steadfast Courier',
    description: 'Trusted delivery partner for e-commerce',
    logo: '📦',
    fields: [
      {
        name: 'api_key',
        label: 'API Key',
        type: 'text',
        placeholder: 'Enter your Steadfast API Key',
        required: true
      },
      {
        name: 'secret_key',
        label: 'Secret Key',
        type: 'password',
        placeholder: 'Enter your Steadfast Secret Key',
        required: true
      }
    ]
  },
  {
    provider: 'redx',
    display_name: 'RedX Courier',
    description: 'Nationwide delivery support with RedX tracking',
    logo: '📍',
    fields: [
      {
        name: 'api_key',
        label: 'API Key',
        type: 'password',
        placeholder: 'Enter your RedX API Key',
        required: true
      }
    ]
  }
];

const DEFAULT_DELIVERY_SETTINGS: DeliveryShopSettings = {
  default_delivery_charge: 60,
  cod_enabled: false,
  cod_charge: 0,
  non_refundable: false,
  area_pricing: [
    { zone: 'inside_dhaka', charge: 60, cod_enabled: false },
    { zone: 'sub_dhaka', charge: 80, cod_enabled: false },
    { zone: 'outside_dhaka', charge: 120, cod_enabled: false }
  ],
  weight_tiers: [
    { from_kg: 0, to_kg: 1, extra_charge: 0 }
  ]
};

const applyDefaults = (settings?: Partial<DeliveryShopSettings> | null): DeliveryShopSettings => {
  const safe = settings || {};
  const areaPricing = Array.isArray(safe.area_pricing) && safe.area_pricing.length > 0
    ? safe.area_pricing
    : DEFAULT_DELIVERY_SETTINGS.area_pricing;
  const weightTiers = Array.isArray(safe.weight_tiers) && safe.weight_tiers.length > 0
    ? safe.weight_tiers
    : DEFAULT_DELIVERY_SETTINGS.weight_tiers;

  return {
    default_delivery_charge: Number.isFinite(Number(safe.default_delivery_charge))
      ? Number(safe.default_delivery_charge)
      : DEFAULT_DELIVERY_SETTINGS.default_delivery_charge,
    cod_enabled: safe.cod_enabled ?? DEFAULT_DELIVERY_SETTINGS.cod_enabled,
    cod_charge: Number.isFinite(Number(safe.cod_charge))
      ? Number(safe.cod_charge)
      : DEFAULT_DELIVERY_SETTINGS.cod_charge,
    non_refundable: safe.non_refundable ?? DEFAULT_DELIVERY_SETTINGS.non_refundable,
    area_pricing: areaPricing.map((entry) => ({
      zone: entry.zone || 'inside_dhaka',
      charge: Number.isFinite(Number(entry.charge)) ? Number(entry.charge) : 0,
      cod_enabled: Boolean(entry.cod_enabled)
    })),
    weight_tiers: weightTiers.map((entry) => ({
      from_kg: Number.isFinite(Number(entry.from_kg)) ? Number(entry.from_kg) : 0,
      to_kg: Number.isFinite(Number(entry.to_kg)) ? Number(entry.to_kg) : 0,
      extra_charge: Number.isFinite(Number(entry.extra_charge)) ? Number(entry.extra_charge) : 0
    }))
  };
};

export default function DeliverySettings() {
  const { t } = useTranslation();
  const areaZoneOptions = [
    { value: 'inside_dhaka', label: t('manageShop.deliverySettings.zoneInsideDhaka') },
    { value: 'sub_dhaka', label: t('manageShop.deliverySettings.zoneSubDhaka') },
    { value: 'outside_dhaka', label: t('manageShop.deliverySettings.zoneOutsideDhaka') }
  ];
  const [providers, setProviders] = useState<DeliveryProviderStatus[]>([]);
  const [deliverySettings, setDeliverySettings] = useState<DeliveryShopSettings>(DEFAULT_DELIVERY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectingProvider, setConnectingProvider] = useState<DeliveryProvider | null>(null);
  const [disconnectingProvider, setDisconnectingProvider] = useState<DeliveryProvider | null>(null);
  const [testingProvider, setTestingProvider] = useState<DeliveryProvider | null>(null);
  const [togglingProvider, setTogglingProvider] = useState<DeliveryProvider | null>(null);
  const [showCredentialsForm, setShowCredentialsForm] = useState<DeliveryProvider | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [isSandbox, setIsSandbox] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // Load delivery settings on mount
  useEffect(() => {
    loadDeliverySettings();
  }, []);

  const loadDeliverySettings = async () => {
    try {
      setLoading(true);
      setError(null);
      const settings = await apiClient.getDeliverySettings();
      setProviders(settings.providers);
      setDeliverySettings(applyDefaults(settings.settings));
    } catch (err: any) {
      setError(err.response?.data?.message || t('manageShop.deliverySettings.errors.loadFailed'));
      console.error('Failed to load delivery settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    try {
      setSavingSettings(true);
      setError(null);
      setSuccessMessage(null);

      const invalidWeightTier = deliverySettings.weight_tiers.some((tier) => tier.from_kg >= tier.to_kg);
      if (invalidWeightTier) {
        setError(t('manageShop.deliverySettings.errors.invalidWeightTiers'));
        return;
      }

      await apiClient.updateDeliverySettings(deliverySettings);
      setDeliverySettings(applyDefaults(deliverySettings));
      setSuccessMessage(t('manageShop.deliverySettings.success.settingsSaved'));
    } catch (err: any) {
      setError(err.response?.data?.message || t('manageShop.deliverySettings.errors.saveFailed'));
      console.error('Failed to save delivery settings:', err);
    } finally {
      setSavingSettings(false);
    }
  };

  const updateSetting = (key: keyof DeliveryShopSettings, value: any) => {
    setDeliverySettings((prev) => ({
      ...prev,
      [key]: value
    }));
  };

  const updateAreaPricing = (index: number, key: 'zone' | 'charge' | 'cod_enabled', value: any) => {
    setDeliverySettings((prev) => {
      const next = [...prev.area_pricing];
      next[index] = {
        ...next[index],
        [key]: value
      };
      return {
        ...prev,
        area_pricing: next
      };
    });
  };

  const addAreaPricing = () => {
    setDeliverySettings((prev) => ({
      ...prev,
      area_pricing: [
        ...prev.area_pricing,
        { zone: 'inside_dhaka', charge: 0, cod_enabled: false }
      ]
    }));
  };

  const removeAreaPricing = (index: number) => {
    setDeliverySettings((prev) => ({
      ...prev,
      area_pricing: prev.area_pricing.filter((_, idx) => idx !== index)
    }));
  };

  const updateWeightTier = (index: number, key: 'from_kg' | 'to_kg' | 'extra_charge', value: any) => {
    setDeliverySettings((prev) => {
      const next = [...prev.weight_tiers];
      next[index] = {
        ...next[index],
        [key]: value
      };
      return {
        ...prev,
        weight_tiers: next
      };
    });
  };

  const addWeightTier = () => {
    setDeliverySettings((prev) => ({
      ...prev,
      weight_tiers: [
        ...prev.weight_tiers,
        { from_kg: 0, to_kg: 1, extra_charge: 0 }
      ]
    }));
  };

  const removeWeightTier = (index: number) => {
    setDeliverySettings((prev) => ({
      ...prev,
      weight_tiers: prev.weight_tiers.filter((_, idx) => idx !== index)
    }));
  };

  const handleConnect = async (provider: DeliveryProvider) => {
    try {
      setConnectingProvider(provider);
      setError(null);
      setSuccessMessage(null);

      const config = PROVIDER_CONFIGS.find(c => c.provider === provider);
      if (!config) return;

      // Validate all required fields
      for (const field of config.fields) {
        if (field.required && !credentials[field.name]) {
          throw new Error(t('manageShop.deliverySettings.errors.fieldRequired', { field: field.label }));
        }
      }

      await apiClient.connectDeliveryProvider({
        provider,
        credentials: credentials as any,
        is_sandbox: isSandbox
      });

      setSuccessMessage(t('manageShop.deliverySettings.success.connected', { provider: config.display_name }));
      setShowCredentialsForm(null);
      setCredentials({});
      await loadDeliverySettings();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || t('manageShop.deliverySettings.errors.connectFailed'));
      console.error('Failed to connect provider:', err);
    } finally {
      setConnectingProvider(null);
    }
  };

  const handleDisconnect = async (provider: DeliveryProvider) => {
    const config = PROVIDER_CONFIGS.find(c => c.provider === provider);
    if (!confirm(t('manageShop.deliverySettings.disconnectConfirm', { provider: config?.display_name }))) {
      return;
    }

    try {
      setDisconnectingProvider(provider);
      setError(null);
      setSuccessMessage(null);

      await apiClient.disconnectDeliveryProvider(provider);

      setSuccessMessage(t('manageShop.deliverySettings.success.disconnected', { provider: config?.display_name }));
      await loadDeliverySettings();
    } catch (err: any) {
      setError(err.response?.data?.message || t('manageShop.deliverySettings.errors.disconnectFailed'));
      console.error('Failed to disconnect provider:', err);
    } finally {
      setDisconnectingProvider(null);
    }
  };

  const handleToggle = async (provider: DeliveryProvider, currentStatus: boolean) => {
    try {
      setTogglingProvider(provider);
      setError(null);
      setSuccessMessage(null);

      await apiClient.toggleDeliveryProvider(provider, !currentStatus);

      const config = PROVIDER_CONFIGS.find(c => c.provider === provider);
      setSuccessMessage(!currentStatus
        ? t('manageShop.deliverySettings.success.activated', { provider: config?.display_name })
        : t('manageShop.deliverySettings.success.deactivated', { provider: config?.display_name }));
      await loadDeliverySettings();
    } catch (err: any) {
      setError(err.response?.data?.message || t('manageShop.deliverySettings.errors.toggleFailed'));
      console.error('Failed to toggle provider:', err);
    } finally {
      setTogglingProvider(null);
    }
  };

  const handleTest = async (provider: DeliveryProvider) => {
    try {
      setTestingProvider(provider);
      setError(null);
      setSuccessMessage(null);

      await apiClient.testDeliveryConnection(provider);

      const config = PROVIDER_CONFIGS.find(c => c.provider === provider);
      setSuccessMessage(t('manageShop.deliverySettings.success.testSuccess', { provider: config?.display_name }));
    } catch (err: any) {
      setError(err.response?.data?.message || t('manageShop.deliverySettings.errors.testFailed'));
      console.error('Connection test failed:', err);
    } finally {
      setTestingProvider(null);
    }
  };

  const openCredentialsForm = (provider: DeliveryProvider) => {
    setShowCredentialsForm(provider);
    setCredentials({});
    setIsSandbox(false);
    setError(null);
    setSuccessMessage(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Truck className="w-6 h-6 text-gray-700" />
          <h1 className="text-2xl font-semibold text-gray-900">{t('manageShop.deliverySettings.title')}</h1>
        </div>
        <p className="text-sm text-gray-600">
          {t('manageShop.deliverySettings.subtitle')}
        </p>
      </div>

      {/* Success Message */}
      {successMessage && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
          <Check className="w-5 h-5 text-green-600" />
          <p className="text-sm text-green-700">{successMessage}</p>
          <button
            onClick={() => setSuccessMessage(null)}
            className="ml-auto text-green-600 hover:text-green-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-600 hover:text-red-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Delivery Charges */}
      <div className="mb-8 space-y-6">
        <div className="border border-gray-200 rounded-lg bg-white p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">{t('manageShop.deliverySettings.generalSettings')}</h2>
            <button
              onClick={handleSaveSettings}
              disabled={savingSettings}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {savingSettings && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('manageShop.deliverySettings.saveSettings')}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('manageShop.deliverySettings.defaultCharge')}
              </label>
              <input
                type="number"
                value={deliverySettings.default_delivery_charge}
                onChange={(e) => updateSetting('default_delivery_charge', Number(e.target.value) || 0)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('manageShop.deliverySettings.codCharge')}
              </label>
              <input
                type="number"
                value={deliverySettings.cod_charge}
                onChange={(e) => updateSetting('cod_charge', Number(e.target.value) || 0)}
                disabled={!deliverySettings.cod_enabled}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-6">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={deliverySettings.cod_enabled}
                onChange={(e) => updateSetting('cod_enabled', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600"
              />
              {t('manageShop.deliverySettings.enableCOD')}
            </label>

            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={deliverySettings.non_refundable}
                onChange={(e) => updateSetting('non_refundable', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600"
              />
              {t('manageShop.deliverySettings.nonRefundable')}
            </label>
          </div>
        </div>

        <div className="border border-gray-200 rounded-lg bg-white p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">{t('manageShop.deliverySettings.areaBasedPricing')}</h2>
            <button
              onClick={addAreaPricing}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              {t('manageShop.deliverySettings.addArea')}
            </button>
          </div>

          <div className="space-y-3">
            {deliverySettings.area_pricing.map((area, index) => (
              <div key={`${area.zone}-${index}`} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                <div className="md:col-span-4">
                  <select
                    value={area.zone}
                    onChange={(e) => updateAreaPricing(index, 'zone', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  >
                    {areaZoneOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-4">
                  <input
                    type="number"
                    value={area.charge}
                    onChange={(e) => updateAreaPricing(index, 'charge', Number(e.target.value) || 0)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder={t('manageShop.deliverySettings.extraCharge')}
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={area.cod_enabled}
                      onChange={(e) => updateAreaPricing(index, 'cod_enabled', e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600"
                    />
                    {t('manageShop.deliverySettings.codAllowed')}
                  </label>
                </div>
                <div className="md:col-span-1 flex justify-end">
                  <button
                    onClick={() => removeAreaPricing(index)}
                    className="text-gray-400 hover:text-red-500"
                    aria-label="Remove area"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-gray-200 rounded-lg bg-white p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">{t('manageShop.deliverySettings.weightCharges')}</h2>
              <span
                className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-xs font-semibold text-gray-600"
                title="Weight tier guide: Add extra charges by weight range. Example: 0-1 kg = 0, 1-3 kg = 20. Extra charge adds to base delivery charge."
              >
                ?
              </span>
            </div>
            <button
              onClick={addWeightTier}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              {t('manageShop.deliverySettings.addTier')}
            </button>
          </div>

          <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            Add extra charges for weight ranges. Example: 0-1 kg = 0, 1-3 kg = 20, 3-5 kg = 40.
            The extra charge is added on top of the base delivery charge.
          </div>

          <div className="space-y-3">
            {deliverySettings.weight_tiers.map((tier, index) => (
              <div key={`tier-${index}`} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                <div className="md:col-span-3">
                  <input
                    type="number"
                    value={tier.from_kg}
                    onChange={(e) => updateWeightTier(index, 'from_kg', Number(e.target.value) || 0)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder={t('manageShop.deliverySettings.weightFrom')}
                  />
                </div>
                <div className="md:col-span-3">
                  <input
                    type="number"
                    value={tier.to_kg}
                    onChange={(e) => updateWeightTier(index, 'to_kg', Number(e.target.value) || 0)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder={t('manageShop.deliverySettings.weightTo')}
                  />
                </div>
                <div className="md:col-span-4">
                  <input
                    type="number"
                    value={tier.extra_charge}
                    onChange={(e) => updateWeightTier(index, 'extra_charge', Number(e.target.value) || 0)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder={t('manageShop.deliverySettings.extraCharge')}
                  />
                </div>
                <div className="md:col-span-2 flex justify-end">
                  <button
                    onClick={() => removeWeightTier(index)}
                    className="text-gray-400 hover:text-red-500"
                    aria-label="Remove tier"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}

            {deliverySettings.weight_tiers.length === 0 && (
              <p className="text-sm text-gray-500">{t('manageShop.deliverySettings.noTiers')}</p>
            )}
          </div>
        </div>
      </div>

      {/* Provider Cards */}
      <div className="space-y-4">
        {PROVIDER_CONFIGS.map((config) => {
          const providerStatus = providers.find(p => p.provider === config.provider);
          const isConnected = providerStatus?.is_connected || false;
          const isActive = providerStatus?.is_active || false;
          const isConnecting = connectingProvider === config.provider;
          const isDisconnecting = disconnectingProvider === config.provider;
          const isTesting = testingProvider === config.provider;
          const isToggling = togglingProvider === config.provider;
          const showingForm = showCredentialsForm === config.provider;

          return (
            <div key={config.provider} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
              {/* Provider Header */}
              <div className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 flex items-center justify-center bg-gray-100 rounded-lg text-2xl">
                      {config.logo}
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{config.display_name}</h3>
                      <p className="text-sm text-gray-600 mt-1">{config.description}</p>
                      {isConnected && (
                        <div className="flex items-center gap-4 mt-2">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full bg-green-500"></div>
                            <span className="text-xs text-gray-600">{t('manageShop.deliverySettings.connected')}</span>
                          </div>
                          {providerStatus.last_validated_at && (
                            <span className="text-xs text-gray-500">
                              {t('manageShop.deliverySettings.lastTested', { date: new Date(providerStatus.last_validated_at).toLocaleDateString() })}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div>
                    {isActive && (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        {t('manageShop.deliverySettings.statusActive')}
                      </span>
                    )}
                    {isConnected && !isActive && (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                        {t('manageShop.deliverySettings.statusInactive')}
                      </span>
                    )}
                    {!isConnected && (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
                        {t('manageShop.deliverySettings.statusNotConnected')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 mt-6">
                  {!isConnected && (
                    <button
                      onClick={() => openCredentialsForm(config.provider)}
                      disabled={isConnecting}
                      className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {isConnecting && <Loader2 className="w-4 h-4 animate-spin" />}
                      {t('common.connect')}
                    </button>
                  )}

                  {isConnected && (
                    <>
                      <button
                        onClick={() => handleToggle(config.provider, isActive)}
                        disabled={isToggling}
                        className={`px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 ${
                          isActive
                            ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            : 'bg-green-600 text-white hover:bg-green-700'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {isToggling && <Loader2 className="w-4 h-4 animate-spin" />}
                        {!isToggling && <Power className="w-4 h-4" />}
                        {isActive ? t('manageShop.deliverySettings.deactivate') : t('manageShop.deliverySettings.activate')}
                      </button>

                      <button
                        onClick={() => handleTest(config.provider)}
                        disabled={isTesting}
                        className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {isTesting && <Loader2 className="w-4 h-4 animate-spin" />}
                        {!isTesting && <TestTube className="w-4 h-4" />}
                        {t('manageShop.deliverySettings.testConnection')}
                      </button>

                      <button
                        onClick={() => handleDisconnect(config.provider)}
                        disabled={isDisconnecting}
                        className="px-4 py-2 bg-red-50 text-red-600 text-sm font-medium rounded-lg hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {isDisconnecting && <Loader2 className="w-4 h-4 animate-spin" />}
                        {!isDisconnecting && <X className="w-4 h-4" />}
                        {t('common.disconnect')}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Credentials Form */}
              {showingForm && (
                <div className="border-t border-gray-200 bg-gray-50 p-6">
                  <h4 className="text-sm font-semibold text-gray-900 mb-4">
                    Enter {config.display_name} Credentials
                  </h4>

                  <div className="space-y-4">
                    {config.fields.map((field) => (
                      <div key={field.name}>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {field.label}
                          {field.required && <span className="text-red-500 ml-1">*</span>}
                        </label>
                        <input
                          type={field.type}
                          value={credentials[field.name] || ''}
                          onChange={(e) => setCredentials({ ...credentials, [field.name]: e.target.value })}
                          placeholder={field.placeholder}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    ))}

                    {config.provider === 'pathao' && (
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="sandbox"
                          checked={isSandbox}
                          onChange={(e) => setIsSandbox(e.target.checked)}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <label htmlFor="sandbox" className="text-sm text-gray-700">
                          {t('manageShop.deliverySettings.useSandbox')}
                        </label>
                      </div>
                    )}

                    <div className="flex items-center gap-3 pt-2">
                      <button
                        onClick={() => handleConnect(config.provider)}
                        disabled={isConnecting}
                        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {isConnecting && <Loader2 className="w-4 h-4 animate-spin" />}
                        {t('manageShop.deliverySettings.saveConnect')}
                      </button>
                      <button
                        onClick={() => {
                          setShowCredentialsForm(null);
                          setCredentials({});
                        }}
                        className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}
