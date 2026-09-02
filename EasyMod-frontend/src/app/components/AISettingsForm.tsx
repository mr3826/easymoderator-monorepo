import { useState, useRef } from "react";
import { useTranslation } from 'react-i18next';
import { Plus, X, ChevronDown, ChevronUp } from "lucide-react";
import type { ShopAISettings } from "@/api/types/dashboard";
import { DEFAULT_AI_REPLY_MODE, normalizeAiReplyMode, type AiReplyMode } from "@/api/types/conversation";
import { queryClient } from "@/app/lib/queryClient";
import type { TelegramNotificationStatus } from "@/api/types/notification";
import { getErrorMessage } from "@shared/lib/http/errors";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";

type NormalizedShopAISettings = Omit<ShopAISettings, 'automation_mode'> & {
  automation_mode: AiReplyMode;
};

const defaultAISettings: NormalizedShopAISettings = {
  automation_mode: DEFAULT_AI_REPLY_MODE,
  confidence_threshold: 75,
  auto_reply_enabled: false,
  max_auto_order_value: 5000,
  ask_email: false,
  primary_language: "mixed",
  required_fields: {
    customer_name: true,
    mobile_number: true,
    delivery_address: true,
    payment_method: true,
    email_address: false,
    special_instructions: false,
  },
  handoff_settings: {
    trigger_keywords: ["complain", "problem", "issue"],
    notification_channel: "in_app",
    cooldown_minutes: 30,
  },
  greeting: { enabled: true, custom_text: "আসসালামু আলাইকুম! 👋 কীভাবে সাহায্য করতে পারি?" },
  closing: { enabled: true, custom_text: "আমাদের সাথে কেনাকাটা করার জন্য ধন্যবাদ! 🛍️" },
};

type HandoffNotificationChannel = 'in_app' | 'telegram';

const autoReplyForMode = (mode: AiReplyMode) => mode === 'AUTO';

const normalizeNotificationChannel = (channel?: string | null): HandoffNotificationChannel =>
  channel === 'telegram' ? 'telegram' : 'in_app';

const mergeAISettings = (loaded?: Partial<ShopAISettings> | null): NormalizedShopAISettings => {
  const merged = {
    ...defaultAISettings,
    ...loaded,
    required_fields: { ...defaultAISettings.required_fields, ...(loaded?.required_fields || {}) },
    handoff_settings: { ...defaultAISettings.handoff_settings, ...(loaded?.handoff_settings || {}) },
    greeting: { ...defaultAISettings.greeting!, ...(loaded?.greeting || {}) },
    closing: { ...defaultAISettings.closing!, ...(loaded?.closing || {}) },
  };
  const automationMode = normalizeAiReplyMode(merged.automation_mode);
  return {
    ...merged,
    automation_mode: automationMode,
    auto_reply_enabled: autoReplyForMode(automationMode),
    handoff_settings: {
      ...merged.handoff_settings,
      notification_channel: normalizeNotificationChannel(merged.handoff_settings.notification_channel),
    },
  };
};

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

interface AISettingsFormProps {
  initialData?: Partial<ShopAISettings> | null;
  onSave: (data: ShopAISettings) => Promise<void>;
  telegramStatus?: TelegramNotificationStatus | null;
}

export default function AISettingsForm({ initialData, onSave, telegramStatus = null }: AISettingsFormProps) {
  const { t } = useTranslation();
  const [aiSettings, setAISettings] = useState<NormalizedShopAISettings>(() => mergeAISettings(initialData));
  const [savedAISettings, setSavedAISettings] = useState<NormalizedShopAISettings>(() => mergeAISettings(initialData));
  const [showHandoffSection, setShowHandoffSection] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = (type: "success" | "error", message: string) => {
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    setNotice({ type, message });
    if (type === "success") aiTimerRef.current = setTimeout(() => setNotice(null), 3000);
  };

  const isDirty = JSON.stringify(aiSettings) !== JSON.stringify(savedAISettings);
  const telegramConnected = Boolean(telegramStatus?.connected || telegramStatus?.status === 'connected');
  const handleAutomationModeChange = (value: string) => {
    const automationMode = normalizeAiReplyMode(value);
    setAISettings((previous) => ({
      ...previous,
      automation_mode: automationMode,
      auto_reply_enabled: autoReplyForMode(automationMode),
    }));
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      const settingsForSave = {
        ...aiSettings,
        auto_reply_enabled: autoReplyForMode(aiSettings.automation_mode),
      };
      await onSave(settingsForSave);
      try {
        await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      } catch {
        // A cache refresh failure must not turn a successful settings write into an error.
      }
      setAISettings(settingsForSave);
      setSavedAISettings(settingsForSave);
      showNotice("success", t('manageShop.aiSettings.saveSuccess'));
    } catch (error: any) {
      showNotice("error", getErrorMessage(error, t('manageShop.aiSettings.saveError')));
    } finally {
      setIsSaving(false);
    }
  };

  const noticeClass = (type: "success" | "error") =>
    type === "success"
      ? "bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-3 text-sm"
      : "bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm";

  return (
    <section>
      <h3 className="text-base font-semibold text-gray-900 mb-1">{t('manageShop.aiSettings.title')}</h3>
      <p className="text-sm text-gray-500 mb-4">
        {t('manageShop.aiSettings.subtitle')}
      </p>

      {notice && <div className={`mb-4 ${noticeClass(notice.type)}`}>{notice.message}</div>}

      <div className="space-y-6">
        <div>
          <label id="ai-reply-mode-label" className="block text-sm font-medium text-gray-700 mb-2">{t('manageShop.aiSettings.automationModeLabel')}</label>
          <RadioGroup
            value={aiSettings.automation_mode}
            onValueChange={handleAutomationModeChange}
            aria-labelledby="ai-reply-mode-label"
            data-testid="ai-reply-mode"
            className="grid grid-cols-1 gap-3 md:grid-cols-3"
          >
            {([
              {
                mode: 'MANUAL' as AiReplyMode,
                title: t('manageShop.aiSettings.mode.manualTitle'),
                desc: t('manageShop.aiSettings.mode.manualDesc'),
              },
              {
                mode: 'DRAFT' as AiReplyMode,
                title: t('manageShop.aiSettings.mode.draftTitle'),
                desc: t('manageShop.aiSettings.mode.draftDesc'),
              },
              {
                mode: 'AUTO' as AiReplyMode,
                title: t('manageShop.aiSettings.mode.autoTitle'),
                desc: t('manageShop.aiSettings.mode.autoDesc'),
              },
            ]).map((option) => {
              const active = aiSettings.automation_mode === option.mode;
              const optionId = `ai-reply-mode-${option.mode.toLowerCase()}`;
              return (
                <div
                  key={option.mode}
                  className={`relative min-h-24 rounded-xl border p-4 text-left transition-colors ${
                    active ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <RadioGroupItem
                    id={optionId}
                    value={option.mode}
                    data-testid={optionId}
                    aria-label={option.title}
                    className="absolute left-4 top-4"
                  />
                  <label htmlFor={optionId} className="block min-h-16 cursor-pointer pl-7">
                    <p className="mb-0.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{option.mode}</p>
                    <p className="mb-1 text-sm font-bold text-gray-900">{option.title}</p>
                    <p className="text-xs text-gray-600">{option.desc}</p>
                  </label>
                </div>
              );
            })}
          </RadioGroup>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">{t('manageShop.aiSettings.languageLabel')}</label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {([
              { value: 'mixed' as const, label: t('manageShop.aiSettings.language.mixed') },
              { value: 'bn' as const, label: t('manageShop.aiSettings.language.bn') },
              { value: 'en' as const, label: t('manageShop.aiSettings.language.en') },
            ]).map((lang) => (
              <button
                key={lang.value}
                type="button"
                onClick={() => setAISettings({ ...aiSettings, primary_language: lang.value })}
                className={`min-h-12 rounded-lg border px-3 text-sm font-medium ${
                  aiSettings.primary_language === lang.value ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-700'
                }`}
              >
                <span className="font-bold">{lang.value}</span>
                {' — '}
                <span className="text-xs">{lang.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('manageShop.aiSettings.confidenceLabel')} <span className="font-semibold text-blue-700">{aiSettings.confidence_threshold}%</span>
            </label>
            <p className="text-xs text-gray-500 mb-2">{t('manageShop.aiSettings.confidenceHint')}</p>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={aiSettings.confidence_threshold}
              onChange={(e) => setAISettings({ ...aiSettings, confidence_threshold: Number(e.target.value) })}
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>{t('manageShop.aiSettings.confidenceCautious')}</span><span>{t('manageShop.aiSettings.confidenceBalanced')}</span><span>{t('manageShop.aiSettings.confidenceIndependent')}</span>
            </div>
          </div>
          <div>
            <label htmlFor="max-auto-order-value" className="block text-sm font-medium text-gray-700 mb-1">{t('manageShop.aiSettings.maxAutoOrderLabel')}</label>
            <p className="text-xs text-gray-500 mb-2">{t('manageShop.aiSettings.maxAutoOrderHint')}</p>
            <input
              id="max-auto-order-value"
              type="number"
              min={0}
              step={100}
              value={aiSettings.max_auto_order_value}
              onChange={(e) => setAISettings({ ...aiSettings, max_auto_order_value: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div
              onClick={() => setAISettings({ ...aiSettings, ask_email: !aiSettings.ask_email })}
              className={`relative w-10 h-6 rounded-full transition-colors ${aiSettings.ask_email ? "bg-blue-600" : "bg-gray-300"}`}
            >
              <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${aiSettings.ask_email ? "translate-x-4" : ""}`} />
            </div>
            <span className="text-sm text-gray-700">{t('manageShop.aiSettings.askEmail')}</span>
          </label>
        </div>

        <div className="space-y-4 border-t border-gray-100 pt-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('manageShop.aiSettings.greetingLabel')} <span className="text-gray-400 font-normal">{t('manageShop.aiSettings.greetingHint')}</span></label>
            <div className="mb-2 rounded-md bg-gray-100 px-3 py-2 text-xs text-gray-600">
              <span className="font-semibold text-gray-700">{t('manageShop.aiSettings.disclosurePrefix')} </span>
              <span className="font-medium text-gray-800">{t('manageShop.aiSettings.disclosureText')}</span>
              <span> {t('manageShop.aiSettings.disclosureSuffix')}</span>
            </div>
            <textarea
              rows={2}
              aria-label={t('manageShop.aiSettings.greetingLabel')}
              value={aiSettings.greeting?.custom_text || ""}
              onChange={(e) => setAISettings({ ...aiSettings, greeting: { ...aiSettings.greeting!, custom_text: e.target.value } })}
              placeholder={t('manageShop.aiSettings.greetingPlaceholder')}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">{t('manageShop.aiSettings.closingLabel')} <span className="text-gray-400 font-normal">{t('manageShop.aiSettings.closingHint')}</span></label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <div
                  onClick={() => setAISettings({ ...aiSettings, closing: { ...aiSettings.closing!, enabled: !aiSettings.closing?.enabled } })}
                  className={`relative w-10 h-6 rounded-full transition-colors ${aiSettings.closing?.enabled ? "bg-blue-600" : "bg-gray-300"}`}
                >
                  <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${aiSettings.closing?.enabled ? "translate-x-4" : ""}`} />
                </div>
                <span className="text-xs text-gray-600">{aiSettings.closing?.enabled ? t('manageShop.aiSettings.toggleOn') : t('manageShop.aiSettings.toggleOff')}</span>
              </label>
            </div>
            <textarea
              rows={2}
              aria-label={t('manageShop.aiSettings.closingLabel')}
              value={aiSettings.closing?.custom_text || ""}
              onChange={(e) => setAISettings({ ...aiSettings, closing: { ...aiSettings.closing!, custom_text: e.target.value } })}
              placeholder={t('manageShop.aiSettings.closingPlaceholder')}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">{t('manageShop.aiSettings.closingSocialNote')}</p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">{t('manageShop.aiSettings.requiredFieldsLabel')}</label>
          <p className="text-xs text-gray-500 mb-3">{t('manageShop.aiSettings.requiredFieldsHint')}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(Object.keys(aiSettings.required_fields) as Array<keyof ShopAISettings['required_fields']>).map((field) => (
              <label key={field} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={aiSettings.required_fields[field]}
                  onChange={(e) => setAISettings({
                    ...aiSettings,
                    required_fields: { ...aiSettings.required_fields, [field]: e.target.checked }
                  })}
                  className="w-4 h-4 accent-blue-600"
                />
                <span className="text-sm text-gray-700 capitalize">{t(`manageShop.aiSettings.fields.${field}`)}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="border border-gray-200 rounded-lg">
          <button
            type="button"
            onClick={() => setShowHandoffSection(!showHandoffSection)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <span>{t('manageShop.aiSettings.handoffTitle')}</span>
            {showHandoffSection ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showHandoffSection && (
            <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="notification-channel" className="block text-sm font-medium text-gray-700 mb-1">{t('manageShop.aiSettings.notificationChannel')}</label>
                  <select
                    id="notification-channel"
                    value={aiSettings.handoff_settings.notification_channel}
                    onChange={(e) => setAISettings({
                      ...aiSettings,
                      handoff_settings: { ...aiSettings.handoff_settings, notification_channel: e.target.value as HandoffNotificationChannel }
                    })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="in_app">{t('manageShop.aiSettings.notifInApp')}</option>
                    <option value="telegram">{t('manageShop.aiSettings.notifTelegram')}</option>
                  </select>
                  {aiSettings.handoff_settings.notification_channel === 'telegram' && (
                    <p className={`mt-1 text-xs ${telegramConnected ? 'text-green-700' : 'text-amber-700'}`}>
                      {telegramConnected
                        ? t('manageShop.aiSettings.telegramConnected')
                        : t('manageShop.aiSettings.telegramDisconnected')}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="cooldown-minutes" className="block text-sm font-medium text-gray-700 mb-1">{t('manageShop.aiSettings.cooldownLabel')}</label>
                  <input
                    id="cooldown-minutes"
                    type="number"
                    min={0}
                    max={1440}
                    value={aiSettings.handoff_settings.cooldown_minutes}
                    onChange={(e) => setAISettings({
                      ...aiSettings,
                      handoff_settings: { ...aiSettings.handoff_settings, cooldown_minutes: Number(e.target.value) }
                    })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <TagInput
                label={t('manageShop.aiSettings.triggerKeywordsLabel')}
                values={aiSettings.handoff_settings.trigger_keywords}
                onChange={(v) => setAISettings({ ...aiSettings, handoff_settings: { ...aiSettings.handoff_settings, trigger_keywords: v } })}
                placeholder={t('manageShop.aiSettings.triggerKeywordsPlaceholder')}
              />
            </div>
          )}
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
        {isSaving ? t('common.saving') : t('manageShop.aiSettings.saveButton')}
      </button>
    </section>
  );
}
