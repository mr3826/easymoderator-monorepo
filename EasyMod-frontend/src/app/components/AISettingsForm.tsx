import { useState, useRef } from "react";
import { useTranslation } from 'react-i18next';
import { Plus, X, ChevronDown, ChevronUp } from "lucide-react";
import type { ShopAISettings } from "@/api/types/dashboard";

const defaultAISettings: ShopAISettings = {
  automation_mode: "DRAFT",
  confidence_threshold: 60,
  auto_reply_enabled: true,
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
};

const mergeAISettings = (loaded?: Partial<ShopAISettings> | null): ShopAISettings => ({
  ...defaultAISettings,
  ...loaded,
  required_fields: { ...defaultAISettings.required_fields, ...(loaded?.required_fields || {}) },
  handoff_settings: { ...defaultAISettings.handoff_settings, ...(loaded?.handoff_settings || {}) },
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

interface AISettingsFormProps {
  initialData?: Partial<ShopAISettings> | null;
  onSave: (data: ShopAISettings) => Promise<void>;
}

export default function AISettingsForm({ initialData, onSave }: AISettingsFormProps) {
  const { t } = useTranslation();
  const [aiSettings, setAISettings] = useState<ShopAISettings>(() => mergeAISettings(initialData));
  const [savedAISettings, setSavedAISettings] = useState<ShopAISettings>(() => mergeAISettings(initialData));
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

  const handleSave = async () => {
    try {
      setIsSaving(true);
      await onSave(aiSettings);
      setSavedAISettings(aiSettings);
      showNotice("success", "AI settings saved.");
    } catch (error: any) {
      showNotice("error", error.response?.data?.error?.message || "Failed to save AI settings.");
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
      <h3 className="text-base font-semibold text-gray-900 mb-1">AI Behaviour Settings</h3>
      <p className="text-sm text-gray-500 mb-4">
        Control how the AI chatbot operates across all connected channels.
      </p>

      {notice && <div className={`mb-4 ${noticeClass(notice.type)}`}>{notice.message}</div>}

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">বট কিভাবে কাজ করবে?</label>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {([
              {
                mode: 'AUTO' as const,
                title: '🤖 সম্পূর্ণ অটো',
                desc: 'বট নিজেই রিপ্লাই পাঠাবে',
              },
              {
                mode: 'DRAFT' as const,
                title: '👁️ দেখে পাঠান (Draft)',
                desc: 'পাঠানোর আগে আপনাকে দেখাবে',
              },
              {
                mode: 'MANUAL' as const,
                title: '✋ আমিই পাঠাব',
                desc: 'বট নিজে থেকে কিছু পাঠাবে না',
              },
            ]).map((option) => {
              const active = aiSettings.automation_mode === option.mode;
              return (
                <button
                  key={option.mode}
                  type="button"
                  onClick={() => setAISettings({ ...aiSettings, automation_mode: option.mode })}
                  className={`min-h-24 rounded-xl border p-4 text-left transition-colors ${
                    active ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <p className="mb-0.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{option.mode}</p>
                  <p className="mb-1 text-sm font-bold text-gray-900">{option.title}</p>
                  <p className="text-xs text-gray-600">{option.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">বট কিভাবে কথা বলবে?</label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {([
              { value: 'mixed' as const, label: 'বন্ধুত্বপূর্ণ বাংলিশ (ডিফল্ট)' },
              { value: 'bn' as const, label: 'সাধারণ বাংলা' },
              { value: 'en' as const, label: 'ইংরেজি' },
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
              বট কতটা নিশ্চিত হলে নিজে উত্তর পাঠাবে? <span className="font-semibold text-blue-700">{aiSettings.confidence_threshold}%</span>
            </label>
            <p className="text-xs text-gray-500 mb-2">আরও সতর্ক ◀━━━●━━━▶ আরও স্বাধীন</p>
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
              <span>সতর্ক</span><span>মাঝামাঝি</span><span>স্বাধীন</span>
            </div>
          </div>
          <div>
            <label htmlFor="max-auto-order-value" className="block text-sm font-medium text-gray-700 mb-1">Max Auto-Order Value (৳)</label>
            <p className="text-xs text-gray-500 mb-2">Orders above this amount require manual approval.</p>
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
          {([
            { key: "auto_reply_enabled", label: "Auto-reply enabled" },
            { key: "ask_email", label: "Ask customer for email" },
          ] as const).map(({ key, label }) => (
            <label key={key} className="flex items-center gap-3 cursor-pointer select-none">
              <div
                onClick={() => setAISettings({ ...aiSettings, [key]: !aiSettings[key] })}
                className={`relative w-10 h-6 rounded-full transition-colors ${aiSettings[key] ? "bg-blue-600" : "bg-gray-300"}`}
              >
                <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${aiSettings[key] ? "translate-x-4" : ""}`} />
              </div>
              <span className="text-sm text-gray-700">{label}</span>
            </label>
          ))}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Required Order Fields</label>
          <p className="text-xs text-gray-500 mb-3">The AI will ask for these fields before confirming an order.</p>
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
                <span className="text-sm text-gray-700 capitalize">{field.replace(/_/g, " ")}</span>
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
            <span>Human Handoff Settings</span>
            {showHandoffSection ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showHandoffSection && (
            <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="notification-channel" className="block text-sm font-medium text-gray-700 mb-1">Notification Channel</label>
                  <select
                    id="notification-channel"
                    value={aiSettings.handoff_settings.notification_channel}
                    onChange={(e) => setAISettings({
                      ...aiSettings,
                      handoff_settings: { ...aiSettings.handoff_settings, notification_channel: e.target.value as 'in_app' | 'email' | 'sms' }
                    })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="in_app">In-app notification</option>
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="cooldown-minutes" className="block text-sm font-medium text-gray-700 mb-1">Cooldown (minutes)</label>
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
                label="Trigger Keywords"
                values={aiSettings.handoff_settings.trigger_keywords}
                onChange={(v) => setAISettings({ ...aiSettings, handoff_settings: { ...aiSettings.handoff_settings, trigger_keywords: v } })}
                placeholder="e.g. complain, refund"
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
        {isSaving ? "Saving…" : "Save AI Settings"}
      </button>
    </section>
  );
}
