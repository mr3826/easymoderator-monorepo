/**
 * OnboardingWizard — 5-step guided setup for new BD F-commerce sellers.
 *
 * Shows on first login when shop.settings.onboarding_completed is falsy.
 * Steps: Connect Facebook → Add Products → Add FAQs → Set AI Mode → Preview
 *
 * State is persisted to localStorage (key: easymod:onboarding:state) so that
 * an OAuth redirect round-trip to Meta and back preserves progress.
 * Cleared on wizard completion.
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  X, Facebook, Package, Brain, Bot, Eye,
  CheckCircle2, ChevronRight, ChevronLeft, Sparkles,
} from "lucide-react";
import { apiClient } from "@/api";
import { useAuth } from "../../features/auth/AuthProvider";
import { fadeUp, staggerChildren } from "@/lib/motion";

const STORAGE_KEY = "easymod:onboarding:state";

interface PersistedState {
  step: number;
}

function loadPersistedStep(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const parsed: PersistedState = JSON.parse(raw);
    return typeof parsed.step === "number" ? Math.min(parsed.step, 4) : 0;
  } catch {
    return 0;
  }
}

function saveStep(step: number) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ step }));
  } catch { /* quota exceeded — silently skip */ }
}

function clearPersistedStep() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* silently skip */ }
}

interface OnboardingWizardProps {
  onComplete: () => void;
}

const STEPS = [
  {
    id: "facebook",
    icon: Facebook,
    iconColor: "text-blue-600",
    iconBg: "bg-blue-50",
    title: "Facebook Page Connect করুন",
    subtitle: "Step 1 of 5 — Channel",
    description:
      "আপনার Facebook Business Page connect করুন। এটা না করলে AI reply কাজ করবে না।",
    tip: "Facebook Page > Settings > Advanced Messaging > Handover Protocol এ Easy Moderator add করুন।",
    action: "channels",
    actionLabel: "Facebook Connect করুন →",
    skipLabel: "পরে করব",
  },
  {
    id: "products",
    icon: Package,
    iconColor: "text-purple-600",
    iconBg: "bg-purple-50",
    title: "৩-৫টি Product যোগ করুন",
    subtitle: "Step 2 of 5 — Products",
    description:
      "AI কে আপনার product সম্পর্কে জানতে হবে। Name, price, এবং description দিন।",
    tip: "Product এ ছবি যোগ করলে AI image থেকেও product চিনতে পারবে।",
    action: "products/add",
    actionLabel: "Product যোগ করুন →",
    skipLabel: "পরে করব",
  },
  {
    id: "faqs",
    icon: Brain,
    iconColor: "text-amber-600",
    iconBg: "bg-amber-50",
    title: "৫টি Common FAQ দিন",
    subtitle: "Step 3 of 5 — Knowledge Base",
    description:
      "Delivery charge, payment method, return policy — এই ধরনের common প্রশ্নের উত্তর দিন। AI এগুলো শিখে নেবে।",
    tip: "যত বেশি FAQ দেবেন, AI তত accurate হবে।",
    action: "knowledge",
    actionLabel: "FAQ যোগ করুন →",
    skipLabel: "পরে করব",
  },
  {
    id: "ai_mode",
    icon: Bot,
    iconColor: "text-green-600",
    iconBg: "bg-green-50",
    title: "AI Mode: DRAFT রাখুন",
    subtitle: "Step 4 of 5 — AI Settings",
    description:
      "DRAFT mode এ AI reply লিখবে, কিন্তু আপনি approve করার পরেই send হবে। নতুন seller দের জন্য এটাই সবচেয়ে safe।",
    tip: "৭-১৪ দিন DRAFT এ রাখুন। AI ভালো reply দিলে তখন AUTO করতে পারবেন।",
    action: "manage-shop/chat-settings",
    actionLabel: "AI Settings দেখুন →",
    skipLabel: "DRAFT রাখব (Recommended)",
    isRecommended: true,
  },
  {
    id: "preview",
    icon: Eye,
    iconColor: "text-indigo-600",
    iconBg: "bg-indigo-50",
    title: "সব ready! Inbox দেখুন",
    subtitle: "Step 5 of 5 — You're set!",
    description:
      "আপনার setup complete। এখন customer message করলে AI DRAFT reply তৈরি করবে — আপনি approve করলেই send হবে।",
    tip: "Inbox এ গিয়ে দেখুন AI কেমন reply করছে। প্রথম দিকে সব approve করার দরকার নেই — just শিখুন।",
    action: "inbox",
    actionLabel: "Inbox দেখুন →",
    skipLabel: null,
  },
];

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState<number>(() => loadPersistedStep());
  const [completing, setCompleting] = useState(false);
  const navigate = useNavigate();
  const { currentShop } = useAuth();

  // Persist step to localStorage on every change
  useEffect(() => {
    saveStep(step);
  }, [step]);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const progress = ((step + 1) / STEPS.length) * 100;

  const markComplete = async () => {
    if (completing) return;
    try {
      setCompleting(true);
      if (currentShop?.id) {
        await apiClient.updateShop(currentShop.id, {
          settings: { onboarding_completed: true },
        });
      }
    } catch (_) {
      // Non-blocking — wizard completes even if API call fails
    } finally {
      clearPersistedStep();
      setCompleting(false);
      onComplete();
    }
  };

  const handleAction = () => {
    navigate(`/app/${current.action}`);
    if (isLast) {
      markComplete();
    } else {
      setStep((s) => s + 1);
    }
  };

  const handleSkip = () => {
    if (isLast) {
      markComplete();
    } else {
      setStep((s) => s + 1);
    }
  };

  const Icon = current.icon;

  return (
    <div className="fixed inset-0 bg-gray-900/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide font-bn">
                Quick Setup
              </span>
            </div>
            <button
              onClick={markComplete}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              title="Setup skip করুন"
              aria-label="উইজার্ড বন্ধ করুন"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 4-dot progress indicator */}
          <motion.div
            className="flex items-center gap-2 mb-2"
            variants={staggerChildren}
            initial="hidden"
            animate="visible"
          >
            {STEPS.map((s, i) => {
              const isCompleted = i < step;
              const isActive = i === step;
              return (
                <motion.div
                  key={s.id}
                  variants={fadeUp}
                  className="relative"
                >
                  <div
                    className={[
                      "w-7 h-7 rounded-full flex items-center justify-center transition-all duration-300 text-xs font-semibold",
                      isCompleted
                        ? "bg-primary/60 text-white"
                        : isActive
                        ? "bg-primary text-white shadow-md ring-2 ring-primary/30"
                        : "bg-muted text-muted-foreground",
                    ].join(" ")}
                    aria-current={isActive ? "step" : undefined}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      <span>{i + 1}</span>
                    )}
                  </div>
                </motion.div>
              );
            })}
            <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden ml-1">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </motion.div>
          <p className="text-xs text-gray-400 mt-1 font-bn">{step + 1} of {STEPS.length} steps</p>
        </div>

        {/* Step content — animated on step change */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="px-6 py-6"
          >
            <div className={`w-14 h-14 rounded-2xl ${current.iconBg} flex items-center justify-center mb-4`}>
              <Icon className={`w-7 h-7 ${current.iconColor}`} />
            </div>

            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1 font-bn">
              {current.subtitle}
            </p>
            <h2 className="text-xl font-bold text-gray-900 mb-2 font-bn">{current.title}</h2>
            <p className="text-sm text-gray-600 leading-relaxed mb-4 font-bn">{current.description}</p>

            {/* Tip box */}
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 mb-6">
              <p className="text-xs text-amber-700 leading-relaxed font-bn">
                <span className="font-semibold">টিপস: </span>
                {current.tip}
              </p>
            </div>

            {/* Completed steps */}
            {step > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {STEPS.slice(0, step).map((s) => (
                  <span
                    key={s.id}
                    className="flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-100 rounded-full px-2 py-0.5 font-bn"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    {s.id === "facebook" ? "Facebook" :
                     s.id === "products" ? "Products" :
                     s.id === "faqs" ? "FAQs" :
                     s.id === "ai_mode" ? "AI Mode" : "Preview"}
                  </span>
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Actions */}
        <div className="px-6 pb-6 flex flex-col gap-2">
          <motion.button
            onClick={handleAction}
            disabled={completing}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.97 }}
            className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-60 font-bn"
          >
            {isLast ? (
              <>
                <Eye className="w-4 h-4" />
                {current.actionLabel}
              </>
            ) : (
              <>
                {current.actionLabel}
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </motion.button>

          {current.skipLabel && (
            <button
              onClick={handleSkip}
              className={`w-full py-2.5 rounded-xl text-sm font-medium transition-colors font-bn ${
                current.isRecommended
                  ? "bg-green-50 text-green-700 border border-green-200 hover:bg-green-100"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
              }`}
            >
              {current.skipLabel}
            </button>
          )}

          {step > 0 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="flex items-center justify-center gap-1 text-xs text-gray-400 hover:text-gray-600 py-1 font-bn"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              পেছনে যান
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
