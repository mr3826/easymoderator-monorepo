import { useMemo } from "react";
import { Shield, ShieldCheck, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PASSWORD_RULES, getPasswordScore } from "../validation/passwordPolicy";

interface PasswordStrengthMeterProps {
  password: string;
}

interface StrengthResult {
  score: number;
  label: string;
  color: string;
  icon: React.ReactNode;
}

export function PasswordStrengthMeter({ password }: PasswordStrengthMeterProps) {
  const { t } = useTranslation();
  const strength = useMemo<StrengthResult>(() => {
    if (!password) {
      return { score: 0, label: "", color: "", icon: null };
    }

    // One bar per policy rule. Previously the five criteria were clamped to a
    // 4-bar scale, so a password missing the API-required special character
    // still filled every bar and read "Strong" — then failed signup with a 400.
    const score = getPasswordScore(password);

    if (score >= PASSWORD_RULES.length) {
      return { score, label: t("publicFunnel.auth.passwordStrength.strong"), color: "bg-emerald-500", icon: <ShieldCheck className="w-4 h-4 text-emerald-500" /> };
    }
    if (score === PASSWORD_RULES.length - 1) {
      return { score, label: t("publicFunnel.auth.passwordStrength.good"), color: "bg-blue-500", icon: <ShieldCheck className="w-4 h-4 text-blue-500" /> };
    }
    if (score === PASSWORD_RULES.length - 2) {
      return { score, label: t("publicFunnel.auth.passwordStrength.fair"), color: "bg-yellow-500", icon: <Shield className="w-4 h-4 text-yellow-500" /> };
    }
    return { score, label: t("publicFunnel.auth.passwordStrength.weak"), color: "bg-red-500", icon: <ShieldAlert className="w-4 h-4 text-red-500" /> };
  }, [password, t]);

  if (!password) return null;

  return (
    <div className="space-y-1.5" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="flex gap-1 flex-1">
          {PASSWORD_RULES.map((_, i) => i + 1).map((bar) => (
            <div
              key={bar}
              aria-hidden="true"
              className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                bar <= strength.score ? strength.color : "bg-gray-200"
              }`}
            />
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {strength.icon}
          <span className="text-xs font-medium text-[#39445F]">{strength.label}</span>
        </div>
      </div>
    </div>
  );
}
