import { useEffect, useRef, useState } from "react";
import { useTranslation } from 'react-i18next';
import type { BusinessInfo } from "../lib/knowledgeTypes";
import { apiClient } from "@/api";
import type { ShopAISettings } from "@/api/types/dashboard";
import type { TelegramNotificationStatus } from "@/api/types/notification";
import { authService } from "../lib/auth";
import BusinessInfoForm from "./BusinessInfoForm";
import AISettingsForm from "./AISettingsForm";
import { trackFunnelEvent } from "@/app/lib/funnel";
import { getErrorMessage } from "@shared/lib/http/errors";

export default function BusinessInfoSettings() {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [businessInfo, setBusinessInfo] = useState<BusinessInfo | null>(null);
  const [aiSettings, setAiSettings] = useState<ShopAISettings | null>(null);
  const [telegramStatus, setTelegramStatus] = useState<TelegramNotificationStatus | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortControllerRef.current = new AbortController();
    const load = async () => {
      try {
        setIsLoading(true);
        setLoadError(null);
        const [infoData, aiData, telegramData] = await Promise.all([
          apiClient.getShopBusinessInfo(),
          apiClient.getShopAISettings(),
          apiClient.getTelegramNotificationStatus().catch(() => null),
        ]);
        if (!abortControllerRef.current?.signal.aborted) {
          setBusinessInfo(infoData.businessInfo);
          setAiSettings(aiData);
          setTelegramStatus(telegramData);
        }
      } catch (error: any) {
        if (!abortControllerRef.current?.signal.aborted) {
          setLoadError(getErrorMessage(error, t('manageShop.businessInfo.errorLoad')));
        }
      } finally {
        if (!abortControllerRef.current?.signal.aborted) {
          setIsLoading(false);
        }
      }
    };
    load();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleSaveBusinessInfo = async (data: BusinessInfo) => {
    const updated = await apiClient.updateShopBusinessInfo(data);
    trackFunnelEvent("shop_profile_completed", {
      has_phone: Boolean(data.phone),
      has_address: Boolean(data.address),
    }, { onceKey: "shop_profile_completed" });
    await authService.refreshShops();
    return updated;
  };

  const handleSaveAISettings = async (data: ShopAISettings) => {
    await apiClient.updateShopAISettings(data);
  };

  if (isLoading) return <div className="p-6 text-gray-500">{t('manageShop.businessInfo.loading')}</div>;
  if (loadError) return <div className="p-6 text-red-600">{loadError}</div>;

  return (
    <div className="space-y-8 p-6">
      <BusinessInfoForm 
        initialData={businessInfo} 
        onSave={handleSaveBusinessInfo}
        isLoading={isLoading}
      />

      <hr className="border-gray-200" />

      <AISettingsForm
        initialData={aiSettings}
        onSave={handleSaveAISettings}
        telegramStatus={telegramStatus}
      />
    </div>
  );
}
