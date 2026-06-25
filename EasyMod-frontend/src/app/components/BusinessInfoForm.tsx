import { useState, useRef } from "react";
import { useTranslation } from 'react-i18next';
import type { BusinessInfo, SocialLinks } from "../lib/knowledgeTypes";

const emptyBusinessInfo: BusinessInfo = {
  shopName: "",
  address: "",
  phone: "",
  openingHours: "",
  socialLinks: {},
};

// Build only the fields edited here — deliveryAreas / paymentMethods are
// intentionally NOT carried (they live on the Delivery / Payment Settings pages;
// the backend preserves any stored values since this payload omits them).
const normalizeBusinessInfo = (value?: Partial<BusinessInfo> | null): BusinessInfo => ({
  ...emptyBusinessInfo,
  shopName: value?.shopName ?? "",
  address: value?.address ?? "",
  phone: value?.phone ?? "",
  openingHours: value?.openingHours ?? "",
  socialLinks: (value?.socialLinks && typeof value.socialLinks === "object") ? value.socialLinks : {},
});

// Social platforms shown in the order-confirmation closing. WhatsApp accepts a
// wa.me link or a bare phone number; the rest are profile/page URLs.
const SOCIAL_FIELDS: { key: keyof SocialLinks; label: string; placeholder: string }[] = [
  { key: "facebook", label: "Facebook", placeholder: "https://facebook.com/yourpage" },
  { key: "instagram", label: "Instagram", placeholder: "https://instagram.com/yourshop" },
  { key: "whatsapp", label: "WhatsApp", placeholder: "https://wa.me/8801XXXXXXXXX বা 01XXXXXXXXX" },
  { key: "tiktok", label: "TikTok", placeholder: "https://tiktok.com/@yourshop" },
  { key: "youtube", label: "YouTube", placeholder: "https://youtube.com/@yourshop" },
  { key: "website", label: "Website", placeholder: "https://yourshop.com" },
];

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

        <div className="border-t border-gray-100 pt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">সোশ্যাল মিডিয়া লিংক</label>
          <p className="text-xs text-gray-500 mb-3">যেগুলো যোগ করবেন সেগুলো অর্ডার নিশ্চিত হওয়ার মেসেজে "আমাদের ফলো করুন" অংশে দেখানো হবে। (ঐচ্ছিক)</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {SOCIAL_FIELDS.map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                <input
                  type="text"
                  aria-label={label}
                  value={businessInfo.socialLinks?.[key] ?? ""}
                  onChange={(e) => setBusinessInfo({
                    ...businessInfo,
                    socialLinks: { ...(businessInfo.socialLinks || {}), [key]: e.target.value },
                  })}
                  placeholder={placeholder}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            ))}
          </div>
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
