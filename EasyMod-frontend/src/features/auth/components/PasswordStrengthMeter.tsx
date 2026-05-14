import { useMemo } from "react";
import { Shield, ShieldCheck, ShieldAlert } from "lucide-react";

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
  const strength = useMemo<StrengthResult>(() => {
    if (!password) {
      return { score: 0, label: "", color: "", icon: null };
    }

    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    const clamped = Math.min(score, 4);

    switch (clamped) {
      case 0:
      case 1:
        return { score: clamped, label: "Weak", color: "bg-red-500", icon: <ShieldAlert className="w-4 h-4 text-red-500" /> };
      case 2:
        return { score: clamped, label: "Fair", color: "bg-yellow-500", icon: <Shield className="w-4 h-4 text-yellow-500" /> };
      case 3:
        return { score: clamped, label: "Good", color: "bg-blue-500", icon: <ShieldCheck className="w-4 h-4 text-blue-500" /> };
      case 4:
        return { score: clamped, label: "Strong", color: "bg-emerald-500", icon: <ShieldCheck className="w-4 h-4 text-emerald-500" /> };
      default:
        return { score: 0, label: "", color: "", icon: null };
    }
  }, [password]);

  if (!password) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="flex gap-1 flex-1">
          {[1, 2, 3, 4].map((bar) => (
            <div
              key={bar}
              className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                bar <= strength.score ? strength.color : "bg-gray-200"
              }`}
            />
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {strength.icon}
          <span className="text-xs font-medium text-gray-600">{strength.label}</span>
        </div>
      </div>
      <p className="text-xs text-gray-500">
        Use 8+ characters with uppercase, lowercase, and numbers
      </p>
    </div>
  );
}
