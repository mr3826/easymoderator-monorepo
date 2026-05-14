import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import LanguageToggle from "./LanguageToggle";
import { subscriptionPlans } from "@/app/lib/subscriptionPlans";

const gradientText: React.CSSProperties = {
  background: "linear-gradient(135deg, #60A5FA 0%, #34D399 100%)",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  backgroundClip: "text",
};

export default function LandingPage() {
  const { t } = useTranslation();

  const features = t('landing.features.items', { returnObjects: true }) as {
    icon: string; title: string; desc: string; colorClass: string;
  }[];

  const testimonials = t('landing.testimonials.items', { returnObjects: true }) as {
    quote: string; name: string; location: string; shop: string; avatar: string; avatarColor: string;
  }[];

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "'Hind Siliguri', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&display=swap');

        @keyframes orb-pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50%       { opacity: 0.7; transform: scale(1.08); }
        }
        @keyframes badge-blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .orb { animation: orb-pulse 5s ease-in-out infinite; }
        .orb-delay { animation-delay: 2.5s; }
        .badge-dot { animation: badge-blink 2s ease-in-out infinite; }
        .animate-fade-in { animation: fade-in 0.6s ease-out forwards; }

        .hero-grid {
          background-image: radial-gradient(circle, rgba(37,99,235,0.18) 1px, transparent 1px);
          background-size: 30px 30px;
        }

        .feature-card { transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.2s, box-shadow 0.2s; }
        .feature-card:hover { transform: translateY(-8px); border-color: #2563EB; box-shadow: 0 12px 32px rgba(37,99,235,0.15); }

        .plan-card { transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s; }
        .plan-card:hover { transform: translateY(-6px); box-shadow: 0 12px 40px rgba(37,99,235,0.12); }

        .testimonial-card { transition: box-shadow 0.3s, transform 0.3s; }
        .testimonial-card:hover { box-shadow: 0 12px 40px rgba(37,99,235,0.12); transform: translateY(-2px); }
      `}</style>

      {/* ── Navbar ─────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 border-b border-gray-100 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 select-none">
            <span className="text-2xl">🤖</span>
            <span className="text-xl font-bold text-gray-900">EasyModerator</span>
          </div>
          <div className="hidden items-center gap-6 md:flex">
            {[
              { label: t('landing.nav.features'), id: "features" },
              { label: t('landing.nav.pricing'),  id: "pricing"  },
              { label: t('landing.nav.contact'),   id: "contact"  },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => scrollTo(item.id)}
                className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors"
              >
                {item.label}
              </button>
            ))}
            <LanguageToggle variant="dark" />
          </div>
          <Link
            to="/signup"
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors shadow-sm"
          >
            {t('landing.nav.getStarted')}
          </Link>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-[#0F172A] hero-grid px-6 py-28 md:py-40">
        <div
          className="orb pointer-events-none absolute -left-40 -top-20 h-[500px] w-[500px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(37,99,235,0.32) 0%, transparent 70%)" }}
        />
        <div
          className="orb orb-delay pointer-events-none absolute -bottom-20 -right-40 h-[500px] w-[500px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(22,163,74,0.28) 0%, transparent 70%)" }}
        />

        <div className="relative mx-auto max-w-4xl text-center">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-4 py-1.5 text-sm text-blue-300">
            <span className="badge-dot h-2 w-2 rounded-full bg-blue-400" />
            {t('landing.hero.badge')}
          </div>

          <h1 className="mb-6 text-5xl font-bold leading-tight text-white md:text-6xl lg:text-7xl animate-fade-in" style={{ animationDelay: '0.1s', animationFillMode: 'both' }}>
            {t('landing.hero.headline1')}{" "}
            <span style={gradientText}>{t('landing.hero.headline2')}</span>
            <br />
            {t('landing.hero.headline3')}
          </h1>

          <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-slate-300 md:text-xl animate-fade-in" style={{ animationDelay: '0.2s', animationFillMode: 'both' }}>
            {t('landing.hero.subheadline')}
          </p>

          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row animate-fade-in" style={{ animationDelay: '0.3s', animationFillMode: 'both' }}>
            <Link
              to="/signup"
              className="rounded-xl bg-blue-600 px-9 py-4 text-base font-semibold text-white shadow-lg shadow-blue-600/30 hover:bg-blue-500 hover:shadow-blue-500/40 hover:scale-105 transition-all duration-200"
            >
              {t('landing.hero.ctaStart')}
            </Link>
            <Link
              to="/signin"
              className="rounded-xl border border-white/20 bg-white/5 px-9 py-4 text-base font-semibold text-white hover:bg-white/10 hover:border-white/40 transition-all duration-200"
            >
              {t('landing.hero.ctaDemo')}
            </Link>
          </div>

          <div className="mt-16 flex flex-wrap items-center justify-center gap-12 border-t border-white/10 pt-10">
            {[
              { value: t('landing.hero.stat1Value'), label: t('landing.hero.stat1Label') },
              { value: t('landing.hero.stat2Value'), label: t('landing.hero.stat2Label') },
              { value: t('landing.hero.stat3Value'), label: t('landing.hero.stat3Label') },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-4xl font-bold text-white">{stat.value}</div>
                <div className="mt-1 text-sm text-slate-400">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────── */}
      <section id="features" className="bg-white px-6 py-24">
        <div className="mx-auto max-w-7xl">
          <div className="mb-14 text-center">
            <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-blue-600">
              {t('landing.features.label')}
            </p>
            <h2 className="text-3xl font-bold text-gray-900 md:text-4xl">{t('landing.features.heading')}</h2>
            <p className="mt-3 text-gray-500">{t('landing.features.subheading')}</p>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="feature-card rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <div className={`mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl text-2xl ${f.colorClass}`}>
                  {f.icon}
                </div>
                <h3 className="mb-2 text-lg font-semibold text-gray-900">{f.title}</h3>
                <p className="text-sm leading-relaxed text-gray-500">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ────────────────────────────────────────────── */}
      <section id="pricing" className="bg-slate-50 px-6 py-24">
        <div className="mx-auto max-w-7xl">
          <div className="mb-14 text-center">
            <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-blue-600">
              {t('landing.pricing.label')}
            </p>
            <h2 className="text-3xl font-bold text-gray-900 md:text-4xl">{t('landing.pricing.heading')}</h2>
            <p className="mt-3 text-gray-500">{t('landing.pricing.subheading')}</p>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {subscriptionPlans.map((plan) => (
              <div
                key={plan.id}
                className={`plan-card relative flex flex-col rounded-2xl p-6 ${
                  plan.popular
                    ? "border-2 border-blue-600 bg-white shadow-2xl shadow-blue-600/15"
                    : "border border-gray-200 bg-white shadow-sm"
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-0 right-0 flex justify-center">
                    <span className="rounded-full bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white shadow-md">
                      {t('landing.pricing.mostPopular')}
                    </span>
                  </div>
                )}

                <div className="mb-5 pt-1">
                  <h3 className="text-xl font-bold text-gray-900">{plan.name}</h3>
                  <div className="mt-2 flex items-end gap-1">
                    <span className="text-4xl font-bold text-gray-900">
                      ৳{plan.monthlyPrice.toLocaleString()}
                    </span>
                    <span className="mb-1 text-sm text-gray-400">{t('landing.pricing.perMonth')}</span>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-blue-600">{plan.description}</p>
                </div>

                <ul className="mb-6 flex-1 space-y-2.5">
                  {plan.highlights.map((feat) => (
                    <li key={feat} className="flex items-start gap-2 text-sm text-gray-600">
                      <span className="mt-0.5 shrink-0 text-green-500">✓</span>
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  to="/signup"
                  className={`block rounded-xl py-3 text-center text-sm font-semibold transition-all ${
                    plan.popular
                      ? "bg-blue-600 text-white shadow-lg shadow-blue-600/25 hover:bg-blue-700"
                      : "border border-gray-200 text-gray-700 hover:border-blue-600 hover:text-blue-600"
                  }`}
                >
                  {t('landing.pricing.getStarted')}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ───────────────────────────────────────── */}
      <section className="bg-white px-6 py-24">
        <div className="mx-auto max-w-7xl">
          <div className="mb-14 text-center">
            <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-blue-600">
              {t('landing.testimonials.label')}
            </p>
            <h2 className="text-3xl font-bold text-gray-900 md:text-4xl">{t('landing.testimonials.heading')}</h2>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {testimonials.map((t_) => (
              <div key={t_.name} className="testimonial-card rounded-2xl border border-gray-100 bg-white p-7 shadow-sm">
                <p className="mb-1 text-5xl font-bold leading-none text-blue-100">"</p>
                <p className="mb-6 text-gray-700 leading-relaxed">{t_.quote}</p>
                <div className="flex items-center gap-3">
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${t_.avatarColor}`}>
                    {t_.avatar}
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900">{t_.name}</div>
                    <div className="text-xs text-gray-400">{t_.shop} · {t_.location}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA Banner ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-[#0F172A] px-6 py-28">
        <div
          className="orb pointer-events-none absolute left-1/2 top-0 h-96 w-96 -translate-x-1/2 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(37,99,235,0.25) 0%, transparent 70%)" }}
        />
        <div className="relative mx-auto max-w-3xl text-center">
          <h2 className="mb-4 text-4xl font-bold text-white md:text-5xl">
            {t('landing.cta.heading1')}{" "}
            <span style={gradientText}>{t('landing.cta.heading2')}</span>
          </h2>
          <p className="mb-10 text-xl text-slate-300">{t('landing.cta.subheading')}</p>
          <Link
            to="/signup"
            className="inline-block rounded-xl bg-blue-600 px-12 py-4 text-lg font-semibold text-white shadow-xl shadow-blue-600/30 hover:bg-blue-500 transition-all hover:shadow-blue-500/40"
          >
            {t('landing.cta.button')}
          </Link>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer id="contact" className="border-t border-slate-800 bg-[#0F172A] px-6 py-12">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl">🤖</span>
                <span className="text-lg font-bold text-white">EasyModerator</span>
              </div>
              <p className="mt-1 text-sm text-slate-400">{t('landing.footer.tagline')}</p>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <LanguageToggle variant="light" />
              <Link to="/privacy-policy" className="text-slate-400 hover:text-white transition-colors">
                {t('common.privacyPolicy')}
              </Link>
              <Link to="/terms" className="text-slate-400 hover:text-white transition-colors">
                {t('common.terms')}
              </Link>
              <Link to="/signin" className="text-slate-400 hover:text-white transition-colors">
                {t('common.signIn')}
              </Link>
            </div>
          </div>
          <div className="mt-8 border-t border-slate-800 pt-6 text-center text-sm text-slate-500">
            {t('common.copyright')}
          </div>
        </div>
      </footer>
    </div>
  );
}
