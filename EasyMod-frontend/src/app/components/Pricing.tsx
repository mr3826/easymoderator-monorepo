import { useEffect, useState } from "react";
import { Check, Zap, ArrowRight, MessageSquare, ShoppingCart, Package, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  subscriptionPlans,
  type SubscriptionPlanDefinition,
} from "@/app/lib/subscriptionPlans";
import { getSubscriptionPlans } from "@/api/domains/subscription";
import { publicApiPost } from "@/shared/lib/http/public-client";
import BrandLogo from "./BrandLogo";
import { buildAppUrl } from "@/app/lib/config";
import Seo from "./Seo";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";


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
           <Button
             type="button"
             onClick={onClose}
             className="mt-6 bg-brand text-white hover:bg-brand-hover"
           >
             {t("pricing.partnerModal.ok")}
           </Button>
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
                   className={`w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand ${errors.businessName ? "border-red-400" : "border-gray-300"}`}
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
                   className={`w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand ${errors.phone ? "border-red-400" : "border-gray-300"}`}
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
                   className={`w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand ${errors.pageLink ? "border-red-400" : "border-gray-300"}`}
                />
                {errors.pageLink && <p className="text-xs text-red-500 mt-1">{errors.pageLink}</p>}
              </div>
              {submitError && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {submitError}
                </p>
              )}
               <Button
                 type="submit"
                 disabled={submitting}
                 className="w-full rounded-xl bg-brand py-2.5 text-white hover:bg-brand-hover"
               >
                 {submitting ? t("pricing.partnerModal.submitting") : t("pricing.partnerModal.submit")}
               </Button>
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
  const { t, i18n } = useTranslation();
  const formatNumber = (value: number) => value.toLocaleString(i18n.language === "bn" ? "bn-BD" : "en-US");
  const code = plan.code.toLowerCase();
  const isPopular = plan.code === "GROWTH";
  const isPartner = plan.code === "PARTNER";
  const translatedFeatures = t(`pricing.planFeatures.${code}`, { returnObjects: true });
  const features = Array.isArray(translatedFeatures) ? translatedFeatures as string[] : plan.highlights;

  return (
    <Card className={`relative h-full overflow-visible ${isPopular ? "border-brand bg-slate-950 text-white shadow-xl shadow-emerald-900/20" : "border-gray-200 bg-white"}`}>
      {isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="border-transparent bg-brand text-white">
            {t("pricing.mostPopular")}
          </Badge>
        </div>
      )}
      {isPartner && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="whitespace-nowrap border-transparent bg-slate-900 text-white">
            {t("pricing.partnerEligibleBadge")}
          </Badge>
        </div>
      )}

      <CardHeader className="px-6 pt-8">
        <CardTitle className={isPopular ? "text-white" : "text-gray-900"}>
          {t(`pricing.plans.${code}.name`, plan.name)}
        </CardTitle>
        <p className={`text-sm ${isPopular ? "text-emerald-100" : "text-gray-500"}`}>
          {t(`pricing.plans.${code}.description`, plan.description)}
        </p>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col px-6">
        <div className="mb-5 mt-2">
          <div className="flex items-end gap-1">
            <span className={`text-4xl font-extrabold ${isPopular ? "text-white" : "text-gray-900"}`}>
              ৳{formatNumber(plan.monthlyPrice)}
            </span>
            <span className={`mb-1 text-sm ${isPopular ? "text-emerald-100" : "text-gray-500"}`}>
              {isPartner ? t("pricing.partnerPriceUnit") : t("pricing.perMonth")}
            </span>
          </div>
          <p className={`mt-1 text-xs ${isPopular ? "text-emerald-100" : "text-gray-500"}`}>
            {isPartner ? t("pricing.partnerApplyNote") : t(`pricing.plans.${code}.priceNote`)}
          </p>
        </div>

        <div className={`mb-5 space-y-1.5 rounded-xl p-3 ${isPopular ? "bg-white/10" : "bg-gray-50"}`}>
          <div className={`flex items-center gap-2 text-sm ${isPopular ? "text-white/90" : "text-gray-700"}`}>
            <MessageSquare className="h-4 w-4 shrink-0" />
            {plan.limits.conversations < 0
              ? t("pricing.limits.unlimitedConversations")
               : t("pricing.limits.conversationsPerMonth", { count: plan.limits.conversations })}
          </div>
          {isPartner && (
            <div className={`flex items-center gap-2 text-sm ${isPopular ? "text-white/90" : "text-gray-700"}`}>
              <ShoppingCart className="h-4 w-4 shrink-0" />
              {t("pricing.limits.deliveredOrders")}
            </div>
          )}
          {!isPartner && (
            <div className={`flex items-center gap-2 text-sm ${isPopular ? "text-white/90" : "text-gray-700"}`}>
              <Package className="h-4 w-4 shrink-0" />
              {t("pricing.limits.manualInbox")}
            </div>
          )}
        </div>
        {isPartner && plan.partnerOrderTiers && (
          <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <p className="mb-1 font-semibold">{t("pricing.partnerRateBandsTitle")}</p>
            {plan.partnerOrderTiers.map((tier) => (
              <p key={`${tier.minOrders}-${tier.maxOrders}`}>
                {t("pricing.partnerRateBand", {
                  min: formatNumber(tier.minOrders),
                  max: tier.maxOrders ? formatNumber(tier.maxOrders) : "+",
                  rate: formatNumber(tier.rateBdt),
                })}
              </p>
            ))}
          </div>
        )}

        <ul className="mb-6 flex-1 space-y-2">
          {features.map((feature) => (
            <li key={feature} className={`flex items-start gap-2 text-sm ${isPopular ? "text-white/90" : "text-gray-600"}`}>
              <Check className={`mt-0.5 h-4 w-4 shrink-0 ${isPopular ? "text-white" : "text-brand"}`} />
              {feature}
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter className="px-6 pb-6">
      <Button
        type="button"
        onClick={onSelect}
        className={`w-full ${isPopular ? "bg-white text-brand hover:bg-emerald-50" : "bg-brand text-white hover:bg-brand-hover"}`}
      >
        {t(`pricing.plans.${code}.cta`)}
        <ArrowRight className="w-4 h-4" />
      </Button>
      </CardFooter>
    </Card>
  );
}

export default function Pricing() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [showPartnerModal, setShowPartnerModal] = useState(false);
  const [plans, setPlans] = useState<SubscriptionPlanDefinition[]>(subscriptionPlans);

  useEffect(() => {
    let mounted = true;
    getSubscriptionPlans()
      .then((serverPlans) => {
        if (mounted && serverPlans.length > 0) setPlans(serverPlans);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const faqs = [
    { q: t("pricing.faq.q1"), a: t("pricing.faq.a1") },
    { q: t("pricing.faq.q2"), a: t("pricing.faq.a2", { price: plans.find((plan) => plan.code === "GROWTH")?.monthlyPrice ?? 999 }) },
    { q: t("pricing.faq.q3"), a: t("pricing.faq.a3") },
    { q: t("pricing.faq.q4"), a: t("pricing.faq.a4") },
    { q: t("pricing.faq.q5"), a: t("pricing.faq.a5") },
  ];
  const growthPrice = plans.find((plan) => plan.code === "GROWTH")?.monthlyPrice ?? 999;

  const handlePlanSelect = (planId: string) => {
    if (planId === "partner") {
      setShowPartnerModal(true);
    } else {
      window.location.assign(buildAppUrl("/signup"));
    }
  };

  return (
    <div className="min-h-screen bg-[#f4fbf7] font-bn">
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
              className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-hover"
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
            <p className="mb-2 text-sm font-semibold uppercase tracking-[0.2em] text-brand">
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

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {plans.map((plan) => (
            <div key={plan.id} className="min-w-0">
              <PlanCard
                plan={plan}
                onSelect={() => handlePlanSelect(plan.id)}
              />
            </div>
          ))}
        </div>

        <p className="mb-16 mt-6 text-center text-sm text-gray-500">
          {t("pricing.partnerTeaser.question")}{" "}
          <button
            type="button"
            onClick={() => setShowPartnerModal(true)}
            className="font-semibold text-brand underline hover:text-brand-hover"
          >
            {t("pricing.partnerTeaser.link")}
          </button>
        </p>

        {/* Core features are shared; the cards above describe scale-specific limits. */}
        <div className="mb-16 overflow-hidden rounded-2xl border border-emerald-100 bg-white">
          <div className="border-b border-emerald-50 px-6 py-5">
            <h2 className="text-xl font-bold text-gray-900">{t("pricing.included.heading")}</h2>
             <p className="text-sm text-gray-500 mt-0.5">{t("pricing.included.subheading", { price: growthPrice.toLocaleString() })}</p>
          </div>
          <div className="grid grid-cols-1 gap-px bg-emerald-50 sm:grid-cols-2">
            {FEATURE_ROWS.map(({ labelKey }) => (
              <div key={labelKey} className="flex items-center gap-2 bg-white p-4 text-sm text-gray-700">
                 <Check className="w-5 h-5 flex-shrink-0 text-brand" />
                {t(labelKey)}
              </div>
            ))}
            <div className="flex items-center gap-2 bg-white p-4 text-sm text-gray-700">
               <Check className="w-5 h-5 flex-shrink-0 text-brand" />
               {t("pricing.features.facebookInbox")}
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
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-8 py-3 font-bold text-white transition-colors hover:bg-brand-hover"
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
