import { useState } from "react";
import { Check, Zap, ArrowRight, MessageSquare, ShoppingCart, Package, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { subscriptionPlans, type SubscriptionPlanDefinition } from "@/app/lib/subscriptionPlans";
import { publicApiPost } from "@/shared/lib/http/public-client";
import BrandLogo from "./BrandLogo";
import { buildAppUrl } from "@/app/lib/config";
import Seo from "./Seo";

const FEATURE_ROWS: { labelKey: string; key: keyof SubscriptionPlanDefinition["features"] }[] = [
  { labelKey: "pricing.features.imageUnderstanding", key: "image_understanding" },
  { labelKey: "pricing.features.advancedAi", key: "advanced_ai" },
  { labelKey: "pricing.features.prioritySupport", key: "priority_support" },
  { labelKey: "pricing.features.customBranding", key: "custom_branding" },
];

interface PartnerFormData {
  businessName: string;
  phone: string;
  pageLink: string;
}

function PartnerApplicationModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<PartnerFormData>({ businessName: "", phone: "", pageLink: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Partial<PartnerFormData>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const validate = () => {
    const e: Partial<PartnerFormData> = {};
    if (!form.businessName.trim()) e.businessName = t("pricing.partnerModal.errors.businessNameRequired");
    if (!form.phone.trim()) e.phone = t("pricing.partnerModal.errors.phoneRequired");
    if (!form.pageLink.trim()) e.pageLink = t("pricing.partnerModal.errors.pageLinkRequired");
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await publicApiPost("/api/partner/apply", form);
      setSubmitted(true);
    } catch (err: any) {
      setSubmitError(err?.message || t("pricing.partnerModal.errors.submitFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
          aria-label={t("common.close")}
        >
          <X className="w-5 h-5" />
        </button>

        {submitted ? (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">{t("pricing.partnerModal.successTitle")}</h3>
            <p className="text-gray-500 text-sm mb-2">
              {t("pricing.partnerModal.successMessage")}
            </p>
            <p className="text-gray-400 text-xs">{t("pricing.partnerModal.successMessageEn")}</p>
            <button
              onClick={onClose}
              className="mt-6 px-6 py-2.5 bg-[#00A651] text-white rounded-xl font-semibold hover:bg-[#008040] transition-colors"
            >
              {t("pricing.partnerModal.ok")}
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-xl font-bold text-gray-900 mb-1">{t("pricing.partnerModal.title")}</h2>
            <p className="text-sm text-gray-500 mb-5">
              {t("pricing.partnerModal.subtitle")}
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("pricing.partnerModal.businessNameLabel")} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.businessName}
                  onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                  placeholder={t("pricing.partnerModal.businessNamePlaceholder")}
                  className={`w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00A651] ${errors.businessName ? "border-red-400" : "border-gray-300"}`}
                />
                {errors.businessName && <p className="text-xs text-red-500 mt-1">{errors.businessName}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("pricing.partnerModal.phoneLabel")} <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+880 1XXX-XXXXXX"
                  className={`w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00A651] ${errors.phone ? "border-red-400" : "border-gray-300"}`}
                />
                {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("pricing.partnerModal.pageLinkLabel")} <span className="text-red-500">*</span>
                </label>
                <input
                  type="url"
                  value={form.pageLink}
                  onChange={(e) => setForm({ ...form, pageLink: e.target.value })}
                  placeholder="https://facebook.com/yourpage"
                  className={`w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00A651] ${errors.pageLink ? "border-red-400" : "border-gray-300"}`}
                />
                {errors.pageLink && <p className="text-xs text-red-500 mt-1">{errors.pageLink}</p>}
              </div>
              {submitError && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {submitError}
                </p>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 bg-[#00A651] text-white font-semibold rounded-xl hover:bg-[#008040] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? t("pricing.partnerModal.submitting") : t("pricing.partnerModal.submit")}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  onSelect,
}: {
  plan: SubscriptionPlanDefinition;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const isPopular = plan.popular;
  const isPartner = plan.id === "partner";

  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-6 ${
        isPopular
          ? "border-[#00A651] bg-[#0F172A] text-white shadow-xl shadow-emerald-900/20"
          : "border-gray-200 bg-white"
      }`}
    >
      {isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="bg-[#00A651] text-white text-xs font-bold px-3 py-1 rounded-full">
            {t("pricing.mostPopular")}
          </span>
        </div>
      )}
      {isPartner && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="bg-slate-900 text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
            {t("pricing.partnerEligibleBadge")}
          </span>
        </div>
      )}

      <div className="mb-4">
        <p className={`text-lg font-bold ${isPopular ? "text-white" : "text-gray-900"}`}>
          {plan.name}
        </p>
        <p className={`text-sm mt-0.5 ${isPopular ? "text-emerald-100" : "text-gray-500"}`}>
          {plan.description}
        </p>
      </div>

      <div className="mb-5">
        <div className="flex items-end gap-1">
          <span className={`text-4xl font-extrabold ${isPopular ? "text-white" : "text-gray-900"}`}>
            ৳{plan.monthlyPrice.toLocaleString()}
          </span>
          <span className={`text-sm mb-1 ${isPopular ? "text-emerald-100" : "text-gray-500"}`}>{t("pricing.perMonth")}</span>
        </div>
        {!isPartner && (
          <p className={`text-xs mt-1 ${isPopular ? "text-emerald-100" : "text-gray-400"}`}>
            {t("pricing.yearlyNote", { price: plan.yearlyPrice.toLocaleString() })}
          </p>
        )}
        {isPartner && (
          <p className={`text-xs mt-1 ${isPopular ? "text-emerald-100" : "text-gray-400"}`}>
            {t("pricing.partnerApplyNote")}
          </p>
        )}
      </div>

      {/* Limits */}
      <div className={`rounded-xl p-3 mb-5 space-y-1.5 ${isPopular ? "bg-white/10" : "bg-gray-50"}`}>
        {[
          // Fair-use framing — we intentionally don't headline the 300 cap.
          { icon: MessageSquare, label: plan.limits.conversations === -1 ? t("pricing.limits.unlimitedConversations") : t("pricing.limits.conversationsFairUse") },
          { icon: ShoppingCart, label: plan.limits.orders === -1 ? t("pricing.limits.unlimitedOrders") : t("pricing.limits.ordersPerMonth", { count: plan.limits.orders }) },
          { icon: Package, label: plan.limits.products === -1 ? t("pricing.limits.unlimitedProducts") : t("pricing.limits.products", { count: plan.limits.products }) },
        ].map(({ icon: Icon, label }) => (
          <div key={label} className={`flex items-center gap-2 text-sm ${isPopular ? "text-white/90" : "text-gray-600"}`}>
            <Icon className="w-3.5 h-3.5 flex-shrink-0" />
            {label}
          </div>
        ))}
      </div>

      {/* Features */}
      <ul className="space-y-2 flex-1 mb-6">
        {plan.highlights.map((h) => (
          <li key={h} className={`flex items-start gap-2 text-sm ${isPopular ? "text-white/90" : "text-gray-600"}`}>
            <Check className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isPopular ? "text-white" : "text-green-600"}`} />
            {h}
          </li>
        ))}
      </ul>

      <button
        onClick={onSelect}
        className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all ${
          isPopular
            ? "bg-white text-[#00A651] hover:bg-emerald-50"
            : "bg-[#00A651] text-white hover:bg-[#008040]"
        }`}
      >
        {isPartner ? t("pricing.applyNow") : t("pricing.startFreeTrial")}
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}

export default function Pricing() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [showPartnerModal, setShowPartnerModal] = useState(false);

  const faqs = [
    { q: t("pricing.faq.q1"), a: t("pricing.faq.a1") },
    { q: t("pricing.faq.q2"), a: t("pricing.faq.a2") },
    { q: t("pricing.faq.q3"), a: t("pricing.faq.a3") },
    { q: t("pricing.faq.q4"), a: t("pricing.faq.a4") },
    { q: t("pricing.faq.q5"), a: t("pricing.faq.a5") },
  ];

  const handlePlanSelect = (planId: string) => {
    if (planId === "partner") {
      setShowPartnerModal(true);
    } else {
      window.location.assign(buildAppUrl("/signup"));
    }
  };

  return (
    <div className="min-h-screen bg-[#f4fbf7]">
      <Seo
        title="EasyModerator Pricing"
        description="Compare EasyModerator plans for Facebook Messenger automation, order capture, and customer support."
        canonicalPath="/pricing"
      />
      {/* Nav bar */}
      <header className="sticky top-0 z-20 border-b border-emerald-100 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <button type="button" onClick={() => navigate("/")} className="shrink-0">
            <BrandLogo size="sm" variant="dark" />
          </button>
          <div className="flex items-center gap-3">
            <a
              href={buildAppUrl("/signin")}
              className="text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              {t("common.signIn")}
            </a>
            <a
              href={buildAppUrl("/signup")}
              className="flex items-center gap-1.5 rounded-lg bg-[#00A651] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#008040]"
            >
              <Zap className="w-3.5 h-3.5" />
              {t("landing.nav.getStarted")}
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-16">
        {/* Hero */}
        <div className="mb-14 text-center">
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.2em] text-[#00A651]">
            {t("pricing.label")}
          </p>
          <h1 className="mb-4 text-4xl font-extrabold text-gray-900 md:text-5xl">
            {t("pricing.hero.heading")}
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-gray-600">
            {t("pricing.hero.subheading")}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3 text-sm text-gray-500">
            <span className="rounded-full border border-emerald-200 bg-white px-4 py-2">{t("pricing.hero.badge1")}</span>
            <span className="rounded-full border border-emerald-200 bg-white px-4 py-2">{t("pricing.hero.badge2")}</span>
            <span className="rounded-full border border-emerald-200 bg-white px-4 py-2">{t("pricing.hero.badge3")}</span>
          </div>
        </div>

        {/* Single Growth plan — one simple price. Partner applies separately. */}
        <div className="flex justify-center mb-6">
          {subscriptionPlans.filter(p => p.id !== 'partner').map((plan) => (
            <div key={plan.id} className="w-full max-w-sm">
              <PlanCard
                plan={plan}
                onSelect={() => handlePlanSelect(plan.id)}
              />
            </div>
          ))}
        </div>

        {/* Partner plan teaser */}
        <p className="mb-16 text-center text-sm text-gray-500">
          {t("pricing.partnerTeaser.question")}{" "}
          <a
            href="mailto:hello@hexabyte.co?subject=Partner Plan Inquiry"
            className="text-[#00A651] underline hover:text-[#008040]"
          >
            {t("pricing.partnerTeaser.link")}
          </a>
        </p>

        {/* Everything included — Growth bundles every feature at one price. */}
        <div className="mb-16 overflow-hidden rounded-2xl border border-emerald-100 bg-white">
          <div className="border-b border-emerald-50 px-6 py-5">
            <h2 className="text-xl font-bold text-gray-900">{t("pricing.included.heading")}</h2>
            <p className="text-sm text-gray-500 mt-0.5">{t("pricing.included.subheading")}</p>
          </div>
          <div className="grid grid-cols-1 gap-px bg-emerald-50 sm:grid-cols-2">
            {FEATURE_ROWS.map(({ labelKey }) => (
              <div key={labelKey} className="flex items-center gap-2 bg-white p-4 text-sm text-gray-700">
                <Check className="w-5 h-5 text-green-600 flex-shrink-0" />
                {t(labelKey)}
              </div>
            ))}
            <div className="flex items-center gap-2 bg-white p-4 text-sm text-gray-700">
              <Check className="w-5 h-5 text-green-600 flex-shrink-0" />
              {t("pricing.features.facebookInbox")}
            </div>
            <div className="flex items-center gap-2 bg-white p-4 text-sm text-gray-700">
              <Check className="w-5 h-5 text-green-600 flex-shrink-0" />
              {t("pricing.features.extraConversationPack")}
            </div>
          </div>
        </div>

        {/* FAQ */}
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">{t("pricing.faq.heading")}</h2>
          {faqs.map(({ q, a }) => (
            <div key={q} className="border-b border-gray-100 py-5">
              <p className="font-semibold text-gray-900 mb-1">{q}</p>
              <p className="text-gray-500 text-sm">{a}</p>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-16 rounded-2xl bg-[#0F172A] p-10 text-center text-white">
          <h2 className="text-3xl font-extrabold mb-3">{t("pricing.cta.heading")}</h2>
          <p className="mb-6 text-emerald-100">{t("pricing.cta.subheading")}</p>
          <a
            href={buildAppUrl("/signup")}
            className="inline-flex items-center gap-2 rounded-xl bg-[#00A651] px-8 py-3 font-bold text-white transition-colors hover:bg-[#008040]"
          >
            <Zap className="w-4 h-4" />
            {t("pricing.cta.button")}
          </a>
        </div>
      </main>

      <footer className="mt-16 border-t border-emerald-100 py-8 text-center text-sm text-gray-400">
        © {new Date().getFullYear()} EasyModerator &bull;{" "}
        <button type="button" className="cursor-pointer hover:text-gray-600" onClick={() => navigate("/privacy-policy")}>
          {t("common.privacyPolicy")}
        </button>
      </footer>

      {showPartnerModal && (
        <PartnerApplicationModal onClose={() => setShowPartnerModal(false)} />
      )}
    </div>
  );
}
