import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/api";
import type { RtoNetworkSettings as Settings } from "@/api/domains/rto-shield";

/**
 * Network RTO / Fake-Order Shield participation panel.
 *
 * The shield gets stronger as more shops join: a phone that burns several shops becomes
 * a global fraud signal that protects everyone. Each shop controls whether it contributes
 * its (phone-only) delivery outcomes and whether it enforces the shared signal.
 */
export default function RtoNetworkSettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    apiClient
      .getRtoNetworkSettings()
      .then((s) => active && setSettings(s))
      .catch(() => active && setSettings({ contribute: true, enforce: true }))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const toggle = async (key: keyof Settings) => {
    if (!settings || saving) return;
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    setSaving(true);
    try {
      const saved = await apiClient.updateRtoNetworkSettings({ [key]: next[key] });
      setSettings(saved);
      toast.success(t("rtoShield.settings.saved"));
    } catch {
      setSettings(settings); // revert
      toast.error(t("rtoShield.settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const Switch = ({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        on ? "bg-emerald-600" : "bg-gray-300"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          on ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );

  return (
    <div className="mb-6 bg-white rounded-2xl shadow-sm border border-emerald-100 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 p-4 md:p-5 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-50">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h3 className="text-sm md:text-base font-semibold text-gray-900">{t("rtoShield.settings.title")}</h3>
            <p className="text-xs md:text-sm text-gray-500">{t("rtoShield.settings.subtitle")}</p>
          </div>
        </div>
        {open ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
      </button>

      {open && (
        <div className="px-4 md:px-5 pb-5 border-t border-gray-100">
          {loading || !settings ? (
            <div className="flex items-center gap-2 py-4 text-gray-500 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> {t("common.loading")}
            </div>
          ) : (
            <div className="space-y-4 pt-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-900">{t("rtoShield.settings.enforceLabel")}</p>
                  <p className="text-xs text-gray-500">{t("rtoShield.settings.enforceHelp")}</p>
                </div>
                <Switch on={settings.enforce} onClick={() => toggle("enforce")} disabled={saving} />
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-900">{t("rtoShield.settings.contributeLabel")}</p>
                  <p className="text-xs text-gray-500">{t("rtoShield.settings.contributeHelp")}</p>
                </div>
                <Switch on={settings.contribute} onClick={() => toggle("contribute")} disabled={saving} />
              </div>
              <p className="text-xs text-gray-400 pt-1">{t("rtoShield.settings.privacyNote")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
