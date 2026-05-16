import { useState, useRef } from "react";
import { useTranslation } from 'react-i18next';
import { Plus, X } from "lucide-react";
import type { BusinessInfo } from "../lib/knowledgeTypes";

const emptyBusinessInfo: BusinessInfo = {
  shopName: "",
  address: "",
  phone: "",
  openingHours: "",
  deliveryAreas: [],
  paymentMethods: [],
};

const normalizeBusinessInfo = (value?: Partial<BusinessInfo> | null): BusinessInfo => ({
  ...emptyBusinessInfo,
  ...value,
  shopName: value?.shopName ?? "",
  address: value?.address ?? "",
  phone: value?.phone ?? "",
  openingHours: value?.openingHours ?? "",
  deliveryAreas: Array.isArray(value?.deliveryAreas) ? value.deliveryAreas : [],
  paymentMethods: Array.isArray(value?.paymentMethods) ? value.paymentMethods : [],
});

interface TagInputProps {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}

function TagInput({ label, values, onChange, placeholder }: TagInputProps) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <div className="flex flex-wrap gap-2 mb-2">
        {values.map((v) => (
          <span key={v} className="flex items-center gap-1 bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} className="hover:text-blue-600">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={add}
          className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

interface BusinessInfoFormProps {
  initialData?: Partial<BusinessInfo> | null;
  onSave: (data: BusinessInfo) => Promise<void>;
  isLoading?: boolean;
}

export default function BusinessInfoForm({ initialData, onSave, isLoading = false }: BusinessInfoFormProps) {
  const { t } = useTranslation();
  const [businessInfo, setBusinessInfo] = useState<BusinessInfo>(() => normalizeBusinessInfo(initialData));
  const [savedBusinessInfo, setSavedBusinessInfo] = useState<BusinessInfo>(() => normalizeBusinessInfo(initialData));
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const infoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = (type: "success" | "error", message: string) => {
    if (infoTimerRef.current) clearTimeout(infoTimerRef.current);
    setNotice({ type, message });
    if (type === "success") infoTimerRef.current = setTimeout(() => setNotice(null), 3000);
  };

  const isDirty = JSON.stringify(businessInfo) !== JSON.stringify(savedBusinessInfo);

  const handleSave = async () => {
    try {
      setIsSaving(true);
      await onSave(businessInfo);
      setSavedBusinessInfo(businessInfo);
      showNotice("success", t('manageShop.businessInfo.successMsg'));
    } catch (error: any) {
      showNotice("error", error.response?.data?.error?.message || t('manageShop.businessInfo.errorUpdate'));
    } finally {
      setIsSaving(false);
    }
  };

  const noticeClass = (type: "success" | "error") =>
    type === "success"
      ? "bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-3 text-sm"
      : "bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm";

  if (isLoading) return <div className="p-6 text-gray-500">{t('manageShop.businessInfo.loading')}</div>;

  return (
    <section>
      <h3 className="text-base font-semibold text-gray-900 mb-4">Business Information</h3>

      {notice && <div className={noticeClass(notice.type)}>{notice.message}</div>}

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('manageShop.businessInfo.shopName')}</label>
            <input
              type="text"
              aria-label={t('manageShop.businessInfo.shopName')}
              value={businessInfo.shopName}
              onChange={(e) => setBusinessInfo({ ...businessInfo, shopName: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('manageShop.businessInfo.phone')}</label>
            <input
              type="text"
              aria-label={t('manageShop.businessInfo.phone')}
              value={businessInfo.phone}
              onChange={(e) => setBusinessInfo({ ...businessInfo, phone: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">{t('manageShop.businessInfo.address')}</label>
          <input
            type="text"
            aria-label={t('manageShop.businessInfo.address')}
            value={businessInfo.address}
            onChange={(e) => setBusinessInfo({ ...businessInfo, address: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">{t('manageShop.businessInfo.openingHours')}</label>
          <input
            type="text"
            aria-label={t('manageShop.businessInfo.openingHours')}
            value={businessInfo.openingHours}
            onChange={(e) => setBusinessInfo({ ...businessInfo, openingHours: e.target.value })}
            placeholder="e.g. Sat–Thu 9am–9pm"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-6">
          <TagInput
            label="Delivery Areas"
            values={businessInfo.deliveryAreas}
            onChange={(v) => setBusinessInfo({ ...businessInfo, deliveryAreas: v })}
            placeholder="e.g. Dhaka, Chittagong"
          />
          <TagInput
            label="Payment Methods"
            values={businessInfo.paymentMethods}
            onChange={(v) => setBusinessInfo({ ...businessInfo, paymentMethods: v })}
            placeholder="e.g. bKash, COD"
          />
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={isSaving || !isDirty}
        className={`mt-6 px-6 py-2.5 rounded-lg text-sm font-medium text-white transition-colors ${
          isSaving || !isDirty
            ? "bg-blue-300 cursor-not-allowed"
            : "bg-blue-600 hover:bg-blue-700"
        }`}
      >
        {isSaving ? t('manageShop.businessInfo.saving') : t('manageShop.businessInfo.saveChanges')}
      </button>
    </section>
  );
}
