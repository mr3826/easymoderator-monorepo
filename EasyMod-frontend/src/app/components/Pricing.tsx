import { useState } from "react";
import { Check, Zap, ArrowRight, MessageSquare, ShoppingCart, Package, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { subscriptionPlans, type SubscriptionPlanDefinition } from "@/app/lib/subscriptionPlans";

const FEATURE_ROWS: { label: string; key: keyof SubscriptionPlanDefinition["features"] }[] = [
  { label: "Image Understanding", key: "image_understanding" },
  { label: "Advanced AI", key: "advanced_ai" },
  { label: "Priority Support", key: "priority_support" },
  { label: "Custom Branding (White-label)", key: "custom_branding" },
];

interface PartnerFormData {
  businessName: string;
  phone: string;
  pageLink: string;
}

function PartnerApplicationModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<PartnerFormData>({ businessName: "", phone: "", pageLink: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Partial<PartnerFormData>>({});

  const validate = () => {
    const e: Partial<PartnerFormData> = {};
    if (!form.businessName.trim()) e.businessName = "Business name is required";
    if (!form.phone.trim()) e.phone = "Phone number is required";
    if (!form.pageLink.trim()) e.pageLink = "Page link is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      await fetch("/api/partner/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
    } catch {
      // submission best-effort; show success regardless so user isn't blocked
    } finally {
      setSubmitting(false);
      setSubmitted(true);
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
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {submitted ? (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">আবেদন পাঠানো হয়েছে!</h3>
            <p className="text-gray-500 text-sm mb-2">
              আমরা আপনার আবেদন পর্যালোচনা করব এবং শীঘ্রই যোগাযোগ করব।
            </p>
            <p className="text-gray-400 text-xs">Your application has been received. We'll be in touch soon.</p>
            <button
              onClick={onClose}
              className="mt-6 px-6 py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
            >
              ঠিক আছে
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-xl font-bold text-gray-900 mb-1">Partner হতে আবেদন করুন</h2>
            <p className="text-sm text-gray-500 mb-5">
              মাসে ৩০০+ অর্ডার আছে? প্রতি ডেলিভার্ড অর্ডারে চার্জ — কোনো মাসিক ফি নেই।
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Business Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.businessName}
                  onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                  placeholder="আপনার শপের নাম"
                  className={`w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.businessName ? "border-red-400" : "border-gray-300"}`}
                />
                {errors.businessName && <p className="text-xs text-red-500 mt-1">{errors.businessName}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+880 1XXX-XXXXXX"
                  className={`w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.phone ? "border-red-400" : "border-gray-300"}`}
                />
                {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Facebook Page Link <span className="text-red-500">*</span>
                </label>
                <input
                  type="url"
                  value={form.pageLink}
                  onChange={(e) => setForm({ ...form, pageLink: e.target.value })}
                  placeholder="https://facebook.com/yourpage"
                  className={`w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.pageLink ? "border-red-400" : "border-gray-300"}`}
                />
                {errors.pageLink && <p className="text-xs text-red-500 mt-1">{errors.pageLink}</p>}
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? "পাঠানো হচ্ছে..." : "আবেদন পাঠান"}
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
  const isPopular = plan.popular;
  const isPartner = plan.id === "partner";

  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-6 ${
        isPopular
          ? "border-blue-600 bg-blue-600 text-white shadow-xl shadow-blue-200"
          : "border-gray-200 bg-white"
      }`}
    >
      {isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="bg-amber-400 text-amber-900 text-xs font-bold px-3 py-1 rounded-full">
            Most Popular
          </span>
        </div>
      )}
      {isPartner && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="bg-purple-500 text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
            ৩০০+ অর্ডার/মাস যোগ্য
          </span>
        </div>
      )}

      <div className="mb-4">
        <p className={`text-lg font-bold ${isPopular ? "text-white" : "text-gray-900"}`}>
          {plan.name}
        </p>
        <p className={`text-sm mt-0.5 ${isPopular ? "text-blue-100" : "text-gray-500"}`}>
          {plan.description}
        </p>
      </div>

      <div className="mb-5">
        <div className="flex items-end gap-1">
          <span className={`text-4xl font-extrabold ${isPopular ? "text-white" : "text-gray-900"}`}>
            ৳{plan.monthlyPrice.toLocaleString()}
          </span>
          <span className={`text-sm mb-1 ${isPopular ? "text-blue-100" : "text-gray-500"}`}>/mo</span>
        </div>
        {!isPartner && (
          <p className={`text-xs mt-1 ${isPopular ? "text-blue-100" : "text-gray-400"}`}>
            or ৳{plan.yearlyPrice.toLocaleString()}/yr · save 2 months
          </p>
        )}
        {isPartner && (
          <p className="text-xs mt-1 text-gray-400">
            আবেদন করুন · যোগ্যতা যাচাই পর সক্রিয় হবে
          </p>
        )}
      </div>

      {/* Limits */}
      <div className={`rounded-xl p-3 mb-5 space-y-1.5 ${isPopular ? "bg-blue-500" : "bg-gray-50"}`}>
        {[
          // Fair-use framing — we intentionally don't headline the 300 cap.
          { icon: MessageSquare, label: plan.limits.conversations === -1 ? "Unlimited conversations" : "AI conversations — fair use" },
          { icon: ShoppingCart, label: plan.limits.orders === -1 ? "Unlimited orders" : `${plan.limits.orders.toLocaleString()} orders/mo` },
          { icon: Package, label: plan.limits.products === -1 ? "Unlimited products" : `${plan.limits.products.toLocaleString()} products` },
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
            ? "bg-white text-blue-600 hover:bg-blue-50"
            : "bg-blue-600 text-white hover:bg-blue-700"
        }`}
      >
        {isPartner ? "আবেদন করুন" : "১৪ দিন ফ্রি ট্রায়াল শুরু করুন"}
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}

export default function Pricing() {
  const navigate = useNavigate();
  const [showPartnerModal, setShowPartnerModal] = useState(false);

  const handlePlanSelect = (planId: string) => {
    if (planId === "partner") {
      setShowPartnerModal(true);
    } else {
      navigate("/signup");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Nav bar */}
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <span
            className="text-xl font-bold text-blue-600 cursor-pointer"
            onClick={() => navigate("/")}
          >
            Easy Moderator
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/signin")}
              className="text-sm text-gray-600 hover:text-gray-900 font-medium"
            >
              Sign in
            </button>
            <button
              onClick={() => navigate("/signup")}
              className="flex items-center gap-1.5 text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 font-medium"
            >
              <Zap className="w-3.5 h-3.5" />
              Get started
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-16">
        {/* Hero */}
        <div className="text-center mb-14">
          <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 mb-4">
            মসৃণ ও সৎ মূল্য নির্ধারণ
          </h1>
          <p className="text-lg text-gray-500 max-w-xl mx-auto">
            আপনার ব্যবসার আকার অনুযায়ী পরিকল্পনা বেছে নিন। কোনো লুকানো ফি নেই।
          </p>
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
        <p className="text-center text-sm text-gray-500 mb-16">
          মাসে ৩০০+ অর্ডার আছে?{" "}
          <a
            href="mailto:hello@hexabyte.co?subject=Partner Plan Inquiry"
            className="text-blue-600 underline hover:text-blue-700"
          >
            Partner Plan সম্পর্কে জানুন →
          </a>
        </p>

        {/* Everything included — Growth bundles every feature at one price. */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden mb-16">
          <div className="px-6 py-5 border-b border-gray-100">
            <h2 className="text-xl font-bold text-gray-900">Growth-এ সবকিছু আছে</h2>
            <p className="text-sm text-gray-500 mt-0.5">কোনো ফিচার লক নেই — একটাই দাম, ৳৯৯৯/মাস।</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-gray-100">
            {FEATURE_ROWS.map(({ label }) => (
              <div key={label} className="flex items-center gap-2 bg-white p-4 text-sm text-gray-700">
                <Check className="w-5 h-5 text-green-600 flex-shrink-0" />
                {label}
              </div>
            ))}
            <div className="flex items-center gap-2 bg-white p-4 text-sm text-gray-700">
              <Check className="w-5 h-5 text-green-600 flex-shrink-0" />
              Facebook + Instagram AI Inbox
            </div>
            <div className="flex items-center gap-2 bg-white p-4 text-sm text-gray-700">
              <Check className="w-5 h-5 text-green-600 flex-shrink-0" />
              Extra conversation pack — যখন দরকার, টপ-আপ করুন
            </div>
          </div>
        </div>

        {/* FAQ */}
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">Frequently asked questions</h2>
          {[
            { q: "কি বিনামূল্যে ট্রায়াল আছে?", a: "হ্যাঁ — নতুন শপ ১৪ দিনের ফ্রি ট্রায়াল পায়, কোনো কার্ড লাগে না। ট্রায়াল চলাকালীন Growth-এর সব ফিচার চালু থাকে।" },
            { q: "ট্রায়াল শেষ হলে কী হবে?", a: "ট্রায়াল শেষে ৳৯৯৯/মাস-এ আপগ্রেড করলে AI চালু থাকবে। না করলে AI অটো-রিপ্লাই বিরতি নেবে, তবে আপনি নিজে ইনবক্স থেকে রিপ্লাই দিতে পারবেন — কোনো ডেটা হারাবে না।" },
            { q: "মাসে কতগুলো AI কথোপকথন পাব?", a: "একটি সাধারণ ক্রমবর্ধমান শপের জন্য যথেষ্ট পরিমাণ (fair-use)। বেশি দরকার হলে Subscription পেজ থেকে যেকোনো সময় conversation top-up কিনে নিতে পারবেন।" },
            { q: "Conversation limit শেষ হলে কী হবে?", a: "একটি ফ্রি বাফার দেওয়া হয়; এরপর AI auto-reply বিরতি নেবে। Subscription পেজ থেকে top-up pack কিনে সাথে সাথে আবার চালু করতে পারবেন।" },
            { q: "Partner প্লানে কীভাবে আবেদন করব?", a: "Pricing পেজের নিচে 'Partner Plan সম্পর্কে জানুন'-এ আবেদন করুন। আমরা ৩০০+ অর্ডার/মাস যাচাই করে অ্যাক্টিভ করি — প্রতি ডেলিভার্ড অর্ডারে চার্জ, কোনো মাসিক ফি নেই।" },
          ].map(({ q, a }) => (
            <div key={q} className="border-b border-gray-100 py-5">
              <p className="font-semibold text-gray-900 mb-1">{q}</p>
              <p className="text-gray-500 text-sm">{a}</p>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-16 bg-blue-600 rounded-2xl p-10 text-center text-white">
          <h2 className="text-3xl font-extrabold mb-3">Ready to automate your shop?</h2>
          <p className="text-blue-100 mb-6">Pick a plan and start today. No hidden fees.</p>
          <button
            onClick={() => navigate("/signup")}
            className="inline-flex items-center gap-2 bg-white text-blue-600 font-bold px-8 py-3 rounded-xl hover:bg-blue-50 transition-colors"
          >
            <Zap className="w-4 h-4" />
            Get started now
          </button>
        </div>
      </main>

      <footer className="border-t border-gray-100 mt-16 py-8 text-center text-sm text-gray-400">
        © {new Date().getFullYear()} Easy Moderator &bull;{" "}
        <span className="cursor-pointer hover:text-gray-600" onClick={() => navigate("/privacy-policy")}>
          Privacy Policy
        </span>
      </footer>

      {showPartnerModal && (
        <PartnerApplicationModal onClose={() => setShowPartnerModal(false)} />
      )}
    </div>
  );
}
